# VIVORA: Roadmap

## Milestones

| Milestone | Goal | Status |
|-----------|------|--------|
| M0 | Repo, specs, prompts documented | Done (this commit) |
| M1 | Backend: upload + parsing + sectioning | Not started |
| M2 | Backend: session + /turn with LLM | Not started |
| M3 | Frontend: upload, level select, transcript UI | Not started |
| M4 | Voice: STT + TTS + silence timer | Not started |
| M5 | Feedback report + local speech metrics | Not started |
| M6 | Error handling, polish, deployment | Not started |
| M7 | Evaluation run + report screenshots | Not started |

## Suggested build order (step by step)

1. Make `/upload` work with one PDF. Print the sections to the console.
2. Hard-code a level and get one good question out of the LLM from one section.
3. Add `/turn` and test it in a terminal before building any UI.
4. Build the plain text version of the UI (typed answers) first.
5. Add TTS for questions, then STT for answers.
6. Add silence nudges.
7. Add the feedback report.
8. Start the evaluation while you still have time to fix problems.

## Future scope

- Support for diagrams and images in the report
- Hindi / Kannada viva practice
- Optional webcam practice with posture/eye-contact tips
- Better speech recognition through a dedicated STT service
- Teacher dashboard (with student consent) to see common weak topics
- Question banks tuned to specific VTU subjects
- Saved session history and progress charts
- Mobile-friendly layout and offline practice mode
- Fine-tuning or retrieval over past viva questions
