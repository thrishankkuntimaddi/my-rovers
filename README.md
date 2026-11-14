# My Rovers

**A series of home-built robotic rovers, from tablet-controlled crawlers to fully autonomous explorers.**

Each rover is a numbered **Mark**. Every Mark adds a new capability on top of the last. The rovers are driven from **RC-Rovers**, a premium Android tablet app with an Apple-style Liquid Glass interface. Each Mark is open-sourced once complete: code, wiring, docs and build videos.

---

**📲 Get the app:** [download RC-Rovers for Android](https://github.com/thrishankkuntimaddi/my-rovers/releases/latest/download/RC-Rovers-1.0.0.apk)

## Models

| Model | Folder | Theme | Status |
|---|---|---|---|
| **MARK 1** | [`Mark1/`](Mark1/README.md) | *Remote control.* ESP32 + L298N rock crawler driven from a Xiaomi Pad 5 over Wi-Fi | 🟡 In development |
| **MARK 2** | `Mark2/` | *Eyes.* Live camera (FPV) in the app, lights, better motor drivers | ⬜ Planned |
| **MARK 3** | `Mark3/` | *Hands.* Pan/tilt gimbal, small arm, more sensors | ⬜ Planned |
| **MARK 4** | `Mark4/` | *Brain.* On-board computer, AI-assisted driving, missions | ⬜ Planned |
| **MARK 5** | `Mark5/` | *3D vision.* LiDAR, SLAM mapping, autonomous errands | ⬜ Planned |

## Repository layout

```
my-rovers/
├── README.md        ← this file: the series
├── Mark1/           ← everything for MARK 1 (docs, firmware, app, media)
└── Mark2/ …         ← future models, same structure
```

Each `MarkN/` folder is self-contained:

```
MarkN/
├── README.md        what this model is, phases, status
├── docs/            hardware & wiring, app design, protocol, build phases
├── firmware/        microcontroller code (Arduino sketches)
├── app/             app design assets / app source
└── media/           photos, diagrams, videos
```

## Principles

1. **One Mark at a time.** Finish, test and release before starting the next.
2. **Test every phase** before moving on. Each phase has a checklist.
3. **Safety first.** Li-ion batteries, fuses, failsafes. A rover must stop by itself if it loses its controller.
4. **Premium software.** The app should feel like a first-party Apple app: Liquid Glass, smooth, colour only when it means something.
5. **Open by default.** Each finished Mark is published for others to build.

## Community

Website · YouTube · LinkedIn · Twitter/X · Discord · Reddit · Instagram · Facebook *(links coming with the MARK 1 launch)*
