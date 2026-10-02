# Fingering research and implementation (v6)

## Sources reviewed

- David A. Randolph, [pydactyl / Parncutt.py](https://github.com/dvdrndlph/pydactyl/blob/master/pydactyl/dactyler/Parncutt.py). Read the header citations and the evaluation logic for practical, comfortable and relaxed spans between fingers, hand position changes, thumb and little finger on black keys, thumb passing, and three-note back-and-forth figures. The research it reproduces is Parncutt et al., *An ergonomic model of keyboard fingering for melodic fragments*, Music Perception 14(4), 341–382 (1997), plus Jacobs (2001) and Balliauw et al. (2017). This does not mean the papers themselves were read directly.
- Marco Musy, [PianoPlayer README](https://github.com/marcomusy/pianoplayer/blob/master/README.md) and [hand.py](https://github.com/marcomusy/pianoplayer/blob/master/pianoplayer/hand.py). Reviewed the idea of searching candidates while considering look-ahead, movement speed, note duration and hand size, and the constraints on duplicated and crossed fingers in simultaneous chords.
- [dlegs / pianoDP.c](https://github.com/dlegs/Optimal-Piano-Fingering-Algorithm/blob/master/pianoDP.c) and [sources.txt](https://github.com/dlegs/Optimal-Piano-Fingering-Algorithm/blob/master/sources.txt). Reviewed the structure of comparing transition costs over the whole sequence with dynamic programming. Monophony-only constraints are not applied to chords as is.
- Irina Lee, [Automatic and Customized Piano Fingering](https://github.com/IrinaLee521/Piano-Fingering/blob/master/README.md). Confirmed that finger numbers run from thumb = 1 to little finger = 5, and that fingering for the same score changes with hand size.

No code or scoring tables from external implementations were incorporated; an original evaluation and search were implemented to fit the existing fixed-length hand model. The source models also differ from each other. For example, the Parncutt implementation above constrains repeated notes to the same finger, while this page takes a different approach that allows finger changes for fast repetitions.

## Mapping to the implementation

| Principle | Resulting motion or choice |
| --- | --- |
| Don't decide a finger from one note alone; think ahead | Dynamic programming over candidates for every attack group. Keeps the previous two shapes and also evaluates back-and-forth figures and upcoming chords |
| Five-finger positions; swapping the thumb with fingers 3 and 4 in scales | Detects one-octave major scales and prefers the standard fingering. Distinguishes end-of-run fingers for continuing octaves |
| Thumb passing differs by hand and by ascending/descending direction | Evaluated with anatomical numbering, distinguishing the thumb passing under from other fingers crossing over the thumb |
| Black keys depend on finger length and fore–aft position relative to white keys | In monophonic lines, costs for the short thumb/little finger on black keys and for passing at unfavorable heights. Black-key chords and octaves are not forbidden |
| Use outer fingers for wide chords | Evaluates span and finger spacing, preferring thumb and little finger. No duplicated fingers or reversed order in simultaneous strikes |
| Play identical figures with stable fingering | Rewards keeping the same chord fingering and returning to the original finger in A–B–A figures |
| Alternate fingers on fast repeated notes; slow repetition may reuse a finger | Scoring of alternation vs. reuse depends on the time interval. Fast repetitions are shared mainly between fingers 2 and 3, including the thumb when needed |
| Don't move the hand needlessly when notes are within reach of one position | Searches a shared palm position without changing finger lengths, and prepares unused fingers over their next keys. Adopted only where spacing and in-between motion are satisfied |
| Prepare large shifts and crossings between notes | New fingering connects to the existing release, joint-angle interpolation, wrist flexion, hand travel and anticipatory finger spread |

Basic examples such as scale fingerings are common practice patterns and are not pasted unconditionally onto every piece. The actual layout of the notes, the reach of fixed-length fingers and inter-finger spacing take priority. Chords use hand-shape candidates and are chosen with the surrounding notes. When there is a long rest in a piece, taking a new position becomes easier.

## What you can see

Under the sounding notes in the score at the top, "R"/"L" and a finger number appear: 1 thumb, 2 index, 3 middle, 4 ring, 5 little finger. The same assignment drives the 3D model's keystrokes. Note durations shown in the score are, as before, estimated from MIDI.

## Limitations

This is automatic fingering that incorporates ergonomic rules. It does not reproduce finger numbers printed in original or edited scores, or the fingering of any particular pianist. MIDI lacks the original phrasing, voicing and articulation, so finger legato is not fully reproduced either. Even when playing from a shared hand position, short release periods required for the model's collision avoidance are kept.

Skeleton lengths, strike positions, finger spacing, in-between motion and the clocks for audio, pedal and score are verified numerically. The 3D shaders and render data are rendered with OpenGL ES to check the form. UI interaction and actual listening in a real browser were not checked because of Chromium launch restrictions in that environment.
