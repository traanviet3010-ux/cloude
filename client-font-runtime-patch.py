from pathlib import Path

ROOT = Path('/work/upstream')

# ---------------------------------------------------------------------------
# Runtime text mapping.
# A Vietnamese sentence needs VNTAHOMA shapes for its plain A-Z/a-z letters
# too, otherwise a word such as "Hướng" mixes VNARIAL H/n/g with VNTAHOMA
# ư/ớ. The atlas contains VNTAHOMA copies of A-Z/a-z in U+E000 private-use
# aliases. English-only strings stay untouched and therefore keep VNARIAL.
# ---------------------------------------------------------------------------
p = ROOT / 'apps/client-next/src/engine/foundation/rendering/ui-glyphs.ts'
s = p.read_text(encoding='utf-8')
anchor = '''export interface GlyphStyle {\n\tfontIndex?: number;\n\tfontStyle?: number;\n\thAlign?: number;\n\tvAlign?: number;\n\toverflow?: "ellipsis" | "clip" | "avoid-overlap";\n}\n'''
helper = anchor + r'''
const HIEUSRO_VI_ALIAS_BASE = 0xE000;
const HIEUSRO_VIETNAMESE_MARK = /[ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ]/u;
const HIEUSRO_VIETNAMESE_WORD = /[A-Za-zÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ]+/gu;

/*
================
hieusroFontText

English-only text remains byte-for-byte unchanged and therefore uses the
original VNARIAL glyph slots. If a string contains real Vietnamese marks,
plain ASCII letters in its prose words are redirected to the VNTAHOMA alias
slots so every Vietnamese word is drawn by one face. Common short native UI
abbreviations (HP, MP, STR, INT, Lv...) remain on VNARIAL.
================
*/
export function hieusroFontText( value: string ): string {
	const text = value.normalize( "NFC" );
	if ( !HIEUSRO_VIETNAMESE_MARK.test( text ) ) return text;
	return text.replace( HIEUSRO_VIETNAMESE_WORD, word => {
		if (
			!HIEUSRO_VIETNAMESE_MARK.test( word ) &&
			(/^[A-Z0-9]{2,}$/.test( word ) || /^[A-Z][a-z]?$/.test( word ))
		) return word;
		return word.replace( /[A-Za-z]/g, c =>
			String.fromCodePoint( HIEUSRO_VI_ALIAS_BASE + c.codePointAt( 0 )! )
		);
	} );
}
'''
if anchor not in s:
    raise SystemExit('ui-glyphs GlyphStyle anchor changed upstream')
s = s.replace(anchor, helper, 1)

# Map before every public text layout path so direct callers (title screen,
# banners, panels) and boxed/colored text all use the same glyph decision.
for signature in (
    '''export function titleColoredText(\n\tatlas: FontAtlas,\n\tvalue: string,\n\trect: UiRect,\n\tclip: UiRect,\n\tcolor: UiQuad["color"],\n\tstyle: GlyphStyle = {}\n): UiQuad[] {\n''',
    '''export function titleTextBox(\n\tatlas: FontAtlas,\n\tvalue: string,\n\trect: UiRect,\n\tclip: UiRect,\n\tcolor: UiQuad["color"],\n\tstyle: GlyphStyle = {}\n): UiQuad[] {\n''',
    '''export function titleText(\n\tatlas: FontAtlas,\n\tvalue: string,\n\trect: UiRect,\n\tclip: UiRect,\n\tcolor: UiQuad["color"],\n\tstyle: GlyphStyle = {}\n): UiQuad[] {\n''',
):
    if signature not in s:
        raise SystemExit('ui-glyphs public text signature changed upstream')
    s = s.replace(signature, signature + '\tvalue = hieusroFontText( value );\n', 1)

p.write_text(s, encoding='utf-8')

# ---------------------------------------------------------------------------
# createUiText has two pre-layout width paths that must use the exact same
# mapped string: run() (caret/selection/measurement) and guideContent tokens.
# ---------------------------------------------------------------------------
p = ROOT / 'apps/client-next/src/engine/runtime/ui/text/text.ts'
s = p.read_text(encoding='utf-8')
old_import = 'import { decodeUiFont, titleText, titleTextBox, drawableGlyph } from "@/engine/foundation/rendering/ui-glyphs";'
new_import = 'import { decodeUiFont, titleText, titleTextBox, drawableGlyph, hieusroFontText } from "@/engine/foundation/rendering/ui-glyphs";'
if old_import not in s:
    raise SystemExit('UI text glyph import changed upstream')
s = s.replace(old_import, new_import, 1)

old_run = 'const text = value, key = fontIndex + ":" + fontStyle + ":" + text, cached = widths.get( key );'
new_run = 'const text = hieusroFontText( value ), key = fontIndex + ":" + fontStyle + ":" + text, cached = widths.get( key );'
if old_run not in s:
    raise SystemExit('UI text run measurement changed upstream')
s = s.replace(old_run, new_run, 1)

old_guide = '''\t\t) {\n\t\t\treturn state.kind === "ready" ?\n\t\t\t\tguideContent( state.font, tokens, rect, clip, color, size ) :\n\t\t\t\t{ quads: [], paths: [], height: 0 };\n\t\t},'''
new_guide = '''\t\t) {\n\t\t\tconst mappedTokens: readonly GuideToken[] = tokens.map( token =>\n\t\t\t\ttoken.kind === "text" ? { ...token, value: hieusroFontText( token.value ) } : token\n\t\t\t);\n\t\t\treturn state.kind === "ready" ?\n\t\t\t\tguideContent( state.font, mappedTokens, rect, clip, color, size ) :\n\t\t\t\t{ quads: [], paths: [], height: 0 };\n\t\t},'''
if old_guide not in s:
    raise SystemExit('UI guide text path changed upstream')
s = s.replace(old_guide, new_guide, 1)

p.write_text(s, encoding='utf-8')
print('HieuSRO Vietnamese runtime font routing installed')
