# Third-party notices

## Piano samples — Splendid Grand Piano

- Steinway grand piano recordings released into the **public domain** by AKAI (c. 2000).
- Obtained from https://github.com/smpldsnds/sfzinstruments-splendid-grand-piano (original SFZ mapping by kinwie, https://sfzinstruments.github.io/pianos/splendid_grand_piano).
- Files: `dist/audio/{PP,Mp,Mf,MF,FF}_*.mp3`. Trimmed, peak-normalized, faded and re-encoded to MP3 for this project.
- Upstream description: `audio-licenses/SPLENDID-README.md`.

## Key-release and pedal noises — Salamander Grand Piano v3

- © Alexander Holm. Licensed under **Creative Commons Attribution 3.0 Unported** (CC BY 3.0), https://creativecommons.org/licenses/by/3.0/
- Original: https://archive.org/details/SalamanderGrandPianoV3 / SFZ edition: https://github.com/sfzinstruments/SalamanderGrandPiano
- Files: `dist/audio/rel*.mp3`, `dist/audio/pedal*.mp3`. Excerpted, trimmed, peak-normalized, faded and re-encoded to MP3 for this project.
- Full license text: `audio-licenses/SALAMANDER-LICENSE.txt`; upstream description: `audio-licenses/SALAMANDER-README.md`.

## MIDI performance data

- © Bernd Krüger, https://www.piano-midi.de/ — **CC BY-NC-SA** (see https://www.piano-midi.de/copy.htm). Non-commercial use only.
- Obtained via https://github.com/cheriell/ClassicalPianoMIDI-dataset and converted to note events and generated fingering (`raw-*.b64`, `dist/songs.js`).
- Pieces: Heroic Polonaise, Für Elise, Moonlight Sonata I, Clair de Lune, Rondo alla Turca, WTC Prelude No. 1, Raindrop Prelude, Revolutionary Étude, Fantaisie-Impromptu, Prelude Op. 28 No. 4, Träumerei (`raw-traumerei.b64`), Liebestraum No. 3 (`raw-liebestraum.b64`) and Golliwogg's Cakewalk (`raw-cakewalk.b64`).

## Public-domain scores — Mutopia Project

- Scott Joplin, *The Entertainer* (1902) and *Maple Leaf Rag* (1899); Erik Satie, *Gymnopédie No. 1* (1888); *New Britain* (Amazing Grace), Virginia Harmony 1831, harmony by Edwin O. Excell (1900). The compositions are in the public domain.
- The LilyPond editions were typeset by Mutopia Project contributors and placed in the **public domain** by the typesetters (https://creativecommons.org/licenses/publicdomain). Source: https://www.mutopiaproject.org/ via https://github.com/MutopiaProject/MutopiaProject.
- Files: `mutopia-sources/*.ly` (updated with `convert-ly`; repeats unfolded and MIDI tempi set for playback) and the MIDI rendered from them with LilyPond 2.25 (`raw-entertainer.b64`, `raw-maple.b64`, `raw-gymnopedie.b64`, `raw-grace.b64`). Dynamics, pedalling, small timing variation and the closing ritardando are added by `add-songs.cjs`.

## Arrangements written for this project

- *When the Saints Go Marching In* (traditional) and the three-verse *Amazing Grace* arrangement are written in `arrangements.cjs` for this project.

## String-instrument repertoire data (`dist/instruments/`)

Note data only — all string-instrument sound is synthesized in the browser. Full provenance lives in each module repo's SOURCES.md (demos-guitarist `sources/`, demos-violinist `data/`, demos-cellist `data/`). Compositions are public domain except where an edition licence is noted.

- Guitar: Albéniz *Asturias*, *Granada*, *Sevilla* and Granados *Andaluza* from Classical Guitar MIDI Archives sequencings (no explicit licence published upstream — used here as note data for a personal demo). Tárrega *Recuerdos de la Alhambra*: Mutopia 810, **CC BY-SA 3.0**; *Capricho Árabe*: Mutopia 1951, **CC BY-SA 4.0**.
- Violin: Massenet *Méditation* from a MusicXML transcription (tedmuller.us; Marsick/Heugel lineage). Bach/Wilhelmj *Air on the G String*: Mutopia 242 (Bach-Gesellschaft edition). Monti *Csárdás*: from a duet MIDI (8notes).
- Cello: Bach *Suite No. 1* movements (BWV 1007) from Mutopia LilyPond editions of the Schirmer 1916 edition (public domain). Saint-Saëns *The Swan*: WIMA/IMSLP MusicXML, Packham typeset, **CC BY-SA 3.0** — the D-major edition, cross-checked against a Durand scan.
