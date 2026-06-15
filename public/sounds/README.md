# Clock sound effects

The public projector clock (the `/clock/<share-token>` viewer link) plays sound
effects, toggled by the speaker button in the top-right corner. They're **not**
played in the director console.

| Event                       | Default (synthesised) | Override file               |
| --------------------------- | --------------------- | --------------------------- |
| New blind level starts      | Deep gong             | `public/sounds/gong.mp3`    |
| Break starts / ends         | Hockey-style buzzer   | `public/sounds/buzzer.mp3`  |
| 1 minute left in a level    | Bright chime          | `public/sounds/chime.mp3`   |
| A player busts out          | Low sting + "Fatality" voice | `public/sounds/fatality.mp3` |

## Using your own clips

Everything works out of the box with synthesised sounds — no files required.
To use your own audio (e.g. an actual "Fatality" sound bite on a bustout), drop
an `.mp3` with the matching filename above into this folder. If the file is
present it's used instead of the synthesised sound; otherwise the synth plays.

Only add audio you have the rights to use.
