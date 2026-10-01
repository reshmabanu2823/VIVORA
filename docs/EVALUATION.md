# VIVORA: Evaluation Plan

We evaluate three things: **is the AI grounded**, **does the voice flow work**, and **do students find it useful**.
Record real numbers, including bad ones.

## 1. Question grounding audit

- Run 4 to 5 different reports (ideally from different branches/projects) and generate about 20 questions in total.
- For each question, mark:

| # | Question | Refers to report content? (Y/N) | Specific or generic? | Fair for the level? |
|---|----------|----------------------------------|----------------------|---------------------|
| 1 | | | | |

- **Metric:** grounded questions / total questions. Target: 80% or more.

## 2. Follow-up quality check

- Pick 10 answers that were deliberately vague, partial, or wrong.
- Check whether the examiner's follow-up targets the actual gap.
- **Metric:** follow-ups that targeted the gap / total.

## 3. Evaluation fairness check

- Give the system 10 answers where you already know the quality (3 strong, 4 partial, 3 weak).
- Compare the system's verdict with yours.
- **Metric:** agreement rate. Note where it disagrees and why.

## 4. Speech pipeline check

- 5 people, 5 answers each, including technical terms.
- Count answers where the transcript had an error that changed the meaning.
- **Metric:** answers with meaning-changing transcript errors / total.

## 5. Student survey (before and after)

Run with 8 to 10 students. Each does one 10-minute session.

**Before session** (1 = not at all, 5 = very)
1. How confident are you about explaining your project aloud?
2. How nervous do you feel about a viva?

**After session**
1. Same two questions again.
2. The questions felt relevant to my project. (1 to 5)
3. The follow-ups felt like a real examiner. (1 to 5)
4. I would use this again before a real viva. (Yes / No)
5. What was the most annoying part? (open text)

**Metric:** average change in confidence and nervousness. Report sample size clearly. With a small group, say it is an indication, not proof.

## 6. Technical measures

| Measure | How |
|---------|-----|
| Time to next question | Log the time from answer submission to question text returned |
| JSON parse failures | Count invalid LLM outputs per 100 turns |
| Cost per session | Tokens used x price |

## 7. Results template

| Test | Sample | Result | Notes |
|------|--------|--------|-------|
| Grounding | 20 questions | _ % | |
| Follow-up targeting | 10 answers | _ % | |
| Verdict agreement | 10 answers | _ % | |
| Transcript errors | 25 answers | _ % | |
| Confidence change | _ students | +_ avg | |
| Avg response time | _ turns | _ s | |

## 8. Honest reporting checklist

- [ ] Sample sizes written next to every number
- [ ] Failures and bad outputs included, with screenshots
- [ ] Limits of a small survey stated
- [ ] No claim that the tool reduces anxiety beyond what the survey shows
