/**
 * pdf.js — Client-side PDF generation for VIVORA Practice Viva Transcripts.
 * Uses jsPDF (loaded globally from jspdf.umd.min.js).
 */

function cleanText(str) {
  if (!str) return '';
  return String(str)
    .replace(/\r\n/g, '\n')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/**
 * Generates and triggers download of a professionally styled PDF transcript.
 * @param {Object} feedback Feedback report object from /feedback
 * @param {Object} [state] Active session state (optional, for level/sessionId)
 */
export function generateTranscriptPDF(feedback, state = {}) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    throw new Error('jsPDF library not loaded');
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const summary = feedback.summary || {};
  const perQuestion = feedback.per_question || [];
  const weakTopics = feedback.weak_topics || [];
  const suggestions = feedback.suggestions || [];

  const marginX = 18;
  const contentWidth = 210 - marginX * 2; // 174 mm
  const pageHeight = 297;
  const bottomMargin = 22;
  let y = 24;

  function ensureSpace(neededHeight) {
    if (y + neededHeight > pageHeight - bottomMargin) {
      doc.addPage();
      y = 22;
      return true;
    }
    return false;
  }

  function printLine(text, x, width, lineHeight, style = 'normal', color = [45, 55, 72], fontSize = 10) {
    doc.setFont('helvetica', style);
    doc.setFontSize(fontSize);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(text || ''), width);
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(line, x, y);
      y += lineHeight;
    }
  }

  // ── Header / Title Block ───────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(26, 42, 74); // Deep Navy
  doc.text('VIVORA', marginX, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(74, 85, 104);
  doc.text('Practice Viva Transcript', marginX, y);
  y += 7;

  // Header decorative rule
  doc.setDrawColor(210, 218, 230);
  doc.setLineWidth(0.5);
  doc.line(marginX, y, marginX + contentWidth, y);
  y += 7;

  // ── Session Details Box ────────────────────────────────────────────────────
  ensureSpace(38);
  doc.setFillColor(248, 250, 252); // Light background
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(marginX, y, contentWidth, 34, 2, 2, 'FD');

  const boxY = y;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text('Session details:', marginX + 5, boxY + 7);

  const rawDate = summary.started_at || new Date().toISOString();
  const dateFormatted = rawDate.replace('T', ' ').slice(0, 16);
  const levelRaw = summary.level || state.level || 'normal';
  const levelCap = levelRaw.charAt(0).toUpperCase() + levelRaw.slice(1);

  const askedCount = summary.questions_asked ?? perQuestion.length;
  const answeredCount = summary.questions_answered ?? perQuestion.filter(q => q.status === 'answered').length;
  const skippedCount = summary.questions_skipped ?? perQuestion.filter(q => q.status === 'skipped').length;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(`•  Date / Time: ${dateFormatted}`, marginX + 7, boxY + 13);
  doc.text(`•  Examiner level: ${levelCap}`, marginX + 7, boxY + 18);
  doc.text(`•  Questions asked: ${askedCount}`, marginX + 7, boxY + 23);
  doc.text(`•  Questions answered: ${answeredCount}`, marginX + 75, boxY + 23);
  doc.text(`•  Questions skipped: ${skippedCount}`, marginX + 130, boxY + 23);
  doc.text(`•  Status: Completed`, marginX + 7, boxY + 28);

  y += 42;

  // ── Questions & Turns ──────────────────────────────────────────────────────
  perQuestion.forEach((turn, idx) => {
    ensureSpace(24);

    // Subtle divider between turns
    if (idx > 0) {
      doc.setDrawColor(235, 238, 242);
      doc.setLineWidth(0.4);
      doc.line(marginX, y, marginX + contentWidth, y);
      y += 6;
    }

    const qNum = idx + 1;
    const isSkipped = turn.status === 'skipped';

    // Q Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(26, 42, 74);
    doc.text(`Q${qNum}`, marginX, y);

    // Section title
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Section: ${cleanText(turn.section || 'General')}`, marginX + 14, y);
    y += 6;

    // Question
    printLine('Question:', marginX, contentWidth, 4.8, 'bold', [30, 41, 59], 9.5);
    printLine(cleanText(turn.question), marginX + 4, contentWidth - 4, 4.8, 'normal', [15, 23, 42], 9.5);
    y += 2;

    // Status Badge / Text
    if (isSkipped) {
      printLine('Status: SKIPPED', marginX, contentWidth, 4.8, 'bold', [100, 116, 139], 9.5);
      y += 1;
      printLine('Student Answer: Skipped', marginX, contentWidth, 4.8, 'italic', [100, 116, 139], 9.5);
      y += 3;
    } else {
      printLine('Status: ANSWERED', marginX, contentWidth, 4.8, 'bold', [22, 101, 52], 9.5);
      y += 1;

      // Student Answer
      printLine('Student Answer:', marginX, contentWidth, 4.8, 'bold', [30, 41, 59], 9.5);
      const studentAns = turn.answer && turn.answer !== '[SKIPPED]' ? turn.answer : '(no answer given)';
      printLine(cleanText(studentAns), marginX + 4, contentWidth - 4, 4.8, 'normal', [30, 41, 59], 9.5);
      y += 2;

      // Evaluation
      const verdict = turn.verdict || 'partial';
      const verdictLabel = verdict.charAt(0).toUpperCase() + verdict.slice(1);
      const verdictColor = verdict === 'strong' ? [22, 101, 52] : (verdict === 'weak' ? [153, 27, 27] : [146, 64, 14]);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(30, 41, 59);
      doc.text('Evaluation:', marginX, y);
      doc.setTextColor(...verdictColor);
      doc.text(verdictLabel, marginX + 24, y);
      y += 5.5;

      // Covered points
      if (turn.covered && turn.covered.length > 0) {
        printLine('Covered points:', marginX, contentWidth, 4.5, 'bold', [30, 41, 59], 9);
        for (const pt of turn.covered) {
          printLine(`•  ${cleanText(pt)}`, marginX + 4, contentWidth - 4, 4.5, 'normal', [22, 101, 52], 9);
        }
        y += 1.5;
      }

      // Missed points
      if (turn.missed && turn.missed.length > 0) {
        printLine('Missed points:', marginX, contentWidth, 4.5, 'bold', [30, 41, 59], 9);
        for (const pt of turn.missed) {
          printLine(`•  ${cleanText(pt)}`, marginX + 4, contentWidth - 4, 4.5, 'normal', [185, 28, 28], 9);
        }
        y += 1.5;
      }

      y += 3;
    }
  });

  // ── Session Feedback Section ───────────────────────────────────────────────
  ensureSpace(45);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.6);
  doc.line(marginX, y, marginX + contentWidth, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(26, 42, 74);
  doc.text('Session Feedback', marginX, y);
  y += 7;

  // Filler words
  const fillersCount = summary.filler_count ?? 0;
  const fillersPerMin = summary.fillers_per_minute != null ? ` (${summary.fillers_per_minute} / min)` : '';
  printLine(`•  Filler word count: ${fillersCount}${fillersPerMin}`, marginX + 2, contentWidth - 2, 5, 'normal', [30, 41, 59], 9.5);

  // Speaking pace
  const paceText = summary.avg_wpm != null
    ? `${summary.avg_wpm} wpm (${summary.pace_note || 'measured pace'})`
    : 'Measured on spoken answers only (typed mode)';
  printLine(`•  Speaking pace: ${paceText}`, marginX + 2, contentWidth - 2, 5, 'normal', [30, 41, 59], 9.5);

  // Weakest topics
  printLine('•  Weakest topics:', marginX + 2, contentWidth - 2, 5, 'bold', [30, 41, 59], 9.5);
  if (weakTopics && weakTopics.length > 0) {
    for (const topic of weakTopics) {
      printLine(`    -  ${cleanText(topic)}`, marginX + 4, contentWidth - 4, 4.8, 'normal', [185, 28, 28], 9);
    }
  } else {
    printLine('    -  None identified (solid performance across evaluated sections)', marginX + 4, contentWidth - 4, 4.8, 'italic', [71, 85, 105], 9);
  }

  // Suggestions for next practice
  printLine('•  Suggestions for next practice:', marginX + 2, contentWidth - 2, 5, 'bold', [30, 41, 59], 9.5);
  if (suggestions && suggestions.length > 0) {
    for (const sugg of suggestions) {
      printLine(`    -  ${cleanText(sugg)}`, marginX + 4, contentWidth - 4, 4.8, 'normal', [30, 41, 59], 9);
    }
  } else {
    printLine('    -  Continue practising explaining technical architecture, tradeoffs, and empirical results.', marginX + 4, contentWidth - 4, 4.8, 'italic', [71, 85, 105], 9);
  }

  // ── Running Page Header & Footer ───────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Top subtle header
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('VIVORA  |  Practice Viva Transcript', marginX, 12);

    // Bottom footer line
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(marginX, 287, marginX + contentWidth, 287);

    // Bottom footer text
    doc.text('Practice feedback only — not an official grade.', marginX, 292);
    doc.text(`Page ${i} of ${totalPages}`, marginX + contentWidth, 292, { align: 'right' });
  }

  // ── Trigger Download ───────────────────────────────────────────────────────
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `VIVORA_Viva_Transcript_${dateStr}.pdf`;
  doc.save(filename);
}
