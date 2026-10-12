from pathlib import Path

ROOT = Path('/work/upstream')
p = ROOT / 'scripts/build/native_ui_font_atlas.py'
s = p.read_text(encoding='utf-8')

# HieuSRO hybrid atlas:
# - VNARIAL keeps the original English/ASCII glyphs and metrics.
# - VNTAHOMA supplies every real Vietnamese Unicode glyph.
# - A private-use alias range stores VNTAHOMA copies of A-Z/a-z. At runtime,
#   Vietnamese strings remap their ASCII letters into that alias range so one
#   Vietnamese word never mixes Arial-shaped and Tahoma-shaped letters.
latin_start = s.index('LATIN_CODEPOINTS = (')
latin_end = s.index('\nCOVERAGE_BATCHES =', latin_start)
latin_block = '''VIETNAMESE_UNICODE_CODEPOINTS = (\n\t0x00C0, 0x00C1, 0x00C2, 0x00C3, 0x00C8, 0x00C9, 0x00CA, 0x00CC, 0x00CD,\n\t0x00D2, 0x00D3, 0x00D4, 0x00D5, 0x00D9, 0x00DA, 0x00DD,\n\t0x00E0, 0x00E1, 0x00E2, 0x00E3, 0x00E8, 0x00E9, 0x00EA, 0x00EC, 0x00ED,\n\t0x00F2, 0x00F3, 0x00F4, 0x00F5, 0x00F9, 0x00FA, 0x00FD,\n\t0x0102, 0x0103, 0x0110, 0x0111, 0x0128, 0x0129, 0x0168, 0x0169,\n\t0x01A0, 0x01A1, 0x01AF, 0x01B0,\n\t*range(0x1EA0, 0x1EFA),\n)\nVIETNAMESE_UNICODE_SET = frozenset(VIETNAMESE_UNICODE_CODEPOINTS)\nHIEUSRO_VI_ALIAS_BASE = 0xE000\nHIEUSRO_ASCII_LETTER_CODEPOINTS = tuple(range(0x41, 0x5B)) + tuple(range(0x61, 0x7B))\nHIEUSRO_VI_ALIAS_CODEPOINTS = tuple(HIEUSRO_VI_ALIAS_BASE + cp for cp in HIEUSRO_ASCII_LETTER_CODEPOINTS)\nHIEUSRO_VI_ALIAS_TO_ASCII = {HIEUSRO_VI_ALIAS_BASE + cp: cp for cp in HIEUSRO_ASCII_LETTER_CODEPOINTS}\nVIETNAMESE_EXTENDED_CODEPOINTS = tuple(cp for cp in VIETNAMESE_UNICODE_CODEPOINTS if cp >= 0x180)\nLATIN_CODEPOINTS = (\n\ttuple(range(0xA0, 0x180)) + VIETNAMESE_EXTENDED_CODEPOINTS + HIEUSRO_VI_ALIAS_CODEPOINTS\n\tif os.environ.get("HIEUSRO_FONT_COVERAGE") == "vi" else range(0xA0, 0x180)\n)'''
s = s[:latin_start] + latin_block + s[latin_end:]

fn_start = s.index('def render_style_freetype(font_record, style):')
fn_end = s.index('\n\n# ================\n# pack_glyphs', fn_start)
hybrid_fn = r'''def render_style_freetype(font_record, style):
	pixel_height = native_gdi_pixel_height(font_record["recordHeight"])
	base_font = ImageFont.truetype(freetype_face(style["name"]), pixel_height)
	base_font.fontmode = "1"

	vi_font = None
	if os.environ.get("HIEUSRO_FONT_COVERAGE") == "vi":
		vi_path = os.environ.get(
			"HIEUSRO_VIET_FONT_BOLD" if style["name"] == "bold" else "HIEUSRO_VIET_FONT"
		) or os.environ.get("HIEUSRO_VIET_FONT")
		if vi_path:
			if not Path(vi_path).is_file():
				raise SystemExit(f"Vietnamese font file does not exist: {vi_path}")
			vi_font = ImageFont.truetype(vi_path, pixel_height)
			vi_font.fontmode = "1"

	ascent, descent = base_font.getmetrics()
	vi_ascent, vi_descent = vi_font.getmetrics() if vi_font is not None else (ascent, descent)
	glyphs = {}
	for batch in COVERAGE_BATCHES:
		for codepoint in batch:
			alias_ascii = HIEUSRO_VI_ALIAS_TO_ASCII.get(codepoint)
			use_vi = vi_font is not None and (alias_ascii is not None or codepoint in VIETNAMESE_UNICODE_SET)
			font = vi_font if use_vi else base_font
			char = chr(alias_ascii if alias_ascii is not None else codepoint)
			mask, (left, top) = font.getmask2(char, mode="1", anchor="ls")
			width, height = mask.size
			pixels = [(x, y) for y in range(height) for x in range(width) if mask.getpixel((x, y))]
			if pixels:
				xs = [x for x, _ in pixels]
				ys = [y for _, y in pixels]
				x0, y0 = min(xs), min(ys)
				pixels = [(x - x0, y - y0) for x, y in pixels]
				width, height = max(xs) - x0 + 1, max(ys) - y0 + 1
				left, top = left + x0, top + y0
			else:
				width = height = 1
				left, top = 0, 0

			# layoutGlyphs positions every glyph against the atlas' base ascent.
			# Shift VNTAHOMA origins by the ascent delta so its accents and baseline
			# land exactly where the Vietnamese face expects without moving English.
			origin_y = -top + ((ascent - vi_ascent) if use_vi else 0)
			glyphs[str(codepoint)] = {
				"width": width, "height": height, "originX": left, "originY": origin_y,
				"advanceX": round(font.getlength(char)), "pixels": pixels,
			}
	advances = [glyph["advanceX"] for glyph in glyphs.values()]
	return {
		"recordHeight": font_record["recordHeight"], "pixelHeight": pixel_height,
		"metricsHeight": ascent + descent, "ascent": ascent, "descent": descent,
		"aveCharWidth": glyphs[str(ord("x"))]["advanceX"], "maxCharWidth": max(advances),
		"weight": FW_BOLD if style["name"] == "bold" else FW_NORMAL,
		"styleSlot": style["slot"], "styleName": style["name"], "glyphs": glyphs,
	}
'''
s = s[:fn_start] + hybrid_fn + s[fn_end:]

p.write_text(s, encoding='utf-8')
print('HieuSRO Vietnamese hybrid atlas with private-use VNTAHOMA aliases installed')
