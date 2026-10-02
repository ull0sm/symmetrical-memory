# PDF fonts

Noto Sans (Latin, Devanagari, Kannada; Regular and Bold) used to embed names in the draw and results PDFs
(see `src/lib/pdf/pdfText.ts`). Licensed under the SIL Open Font License 1.1 (`OFL.txt`); source:
https://github.com/notofonts/notofonts.github.io (fonts/NotoSans, NotoSansDevanagari, NotoSansKannada, `hinted/ttf`).

Add another script by dropping its two TTFs here and adding it to `pdfText.ts` (`Script`, `scriptOf`, `loadFontSet`).
