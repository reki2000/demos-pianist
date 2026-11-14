# Instrument and song selection in the URL

The current selection is represented by `instrument` and `song` query
parameters, for example `?instrument=violin&song=czardas` or
`?instrument=cello&song=swan`. The address updates for all four instruments,
including piano song buttons and programmatic piano selection. Reloading or
opening a copied address restores the same instrument and highlighted song.

User selection changes create browser-history entries. Back/Forward restores
the corresponding selection. Initial restoration and invalid-link correction
replace the current entry, so no intermediate/default selection is added.
Re-selecting the same instrument/song does not add another history entry.

Unknown instruments fall back to piano. Missing/unknown songs fall back to
the chosen instrument's first piece. Song ids are validated against that
instrument's catalogue. The hosting path, other query parameters and fragment
are preserved. Restoration does not start audio. Playback time and camera
are not serialized; reloading starts at the beginning.

The piano still owns its selection and transport. It emits a song-change
event observed by the shell, which owns the URL. URL restoration suppresses
selection writes until the instrument and song have both been applied.

[Browser verification](browser.json) covers all four instruments, reloads,
copied links, history navigation, same-selection history deduplication,
invalid/prototype-like parameters, unrelated parameters/fragments and no
autoplay. [Standalone verification](standalone.json) covers the generated
single-file HTML served over local HTTP and reloaded after selection. Direct `file:` navigation was blocked by the managed Chromium policy (`ERR_BLOCKED_BY_ADMINISTRATOR`) and was not verified.
Software Chromium; no physical-phone test. The [integration regression](integration.json) also covers instrument switches and transport; only the byte comparison with absent sibling repositories was omitted.

```sh
NODE_PATH=/path/to/playwright/node_modules node url-selection-browser-test.cjs
python pack-v8.py
NODE_PATH=/path/to/playwright/node_modules node url-selection-browser-test.cjs --standalone-only
```
