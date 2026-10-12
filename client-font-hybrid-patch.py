from pathlib import Path

ROOT = Path('/work/upstream')
p = ROOT / 'scripts/build/native_ui_font_atlas.py'
s = p.read_text(encoding='utf-8')

# Keep every existing browser/OpenSRO glyph on the original face.  Only the
# Vietnamese code points that are not part of the original retail Latin range
# are rasterized from the user-supplied Vietnamese face.
latin_start = s.index('LATIN_CODEPOINTS = (')
latin_end = s.index('\nCOVERAGE_BATCHES =', latin_start)
latin_block = '''VIETNAMESE_EXTRA_CODEPOINTS = (\n\t0x0102, 0x0103, 0x0110, 0x0111, 0x0128, 0x0129,\n\t0x0168, 0x0169, 0x01A0, 0x01A1, 0x01AF, 0x01B0,\n\t*range(0x1EA0, 0x1EFA),\n)\nVIETNAMESE_EXTRA_SET = frozenset(VIETNAMESE_EXTRA_CODEPOINTS)\nLATIN_CODEPOINTS = (\n\ttuple(range(0xA0, 0x180)) + VIETNAMESE_EXTRA_CODEPOINTS\n\tif os.environ.get("HIEUSRO_FONT_COVERAGE") == "vi" else range(0xA0, 0x180)\n)'''
s = s[:latin_start] + latin_block + s[latin_end:]

fn_start = s.index('def render_style_freetype(font_record, style):')
fn_end = s.index('\n\n# ================\n# pack_glyphs', fn_start)
hybrid_fn = r'''def render_style_freetype(font_record, style):
	pixel_height = native_gdi_pixel_height(font_record["recordHeight"])
	base_font = ImageFont.truetype(freetype_face(style["name"]), pixel_height)
	base_font.fontmode = "1"

	# Vietnamese mode is a glyph overlay, not a replacement font.  ASCII,
	# numbers, punctuation and the complete original Latin batch stay on the
	# original browser face so English and existing UI metrics are untouched.
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
	glyphs = {}
	for batch in COVERAGE_BATCHES:
		for codepoint in batch:
			char = chr(codepoint)
			font = vi_font if vi_font is not None and codepoint in VIETNAMESE_EXTRA_SET else base_font
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
			glyphs[str(codepoint)] = {
				"width": width, "height": height, "originX": left, "originY": -top,
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
print('HieuSRO hybrid Vietnamese glyph overlay installed')
