"""
AM34.1 — automated technical observation, analysis half.

Reads the two CSVs written by `npm run export:observations` (server-side, from
the records the system already persists) and computes what the study reports:

  * a confusion matrix of AI draft band vs teacher-validated band, in DepEd
    Order No. 8, s. 2015 descriptor order;
  * Accuracy, per-band Precision / Recall / F1 with support, and macro-F1;
  * the signed and absolute difference between the two scores;
  * the proportion of drafts a teacher changed at Human-in-the-Loop review;
  * request latency and consumption against the daily allowance.

Nothing here talks to the database, and nothing is recomputed from raw scores
that the app itself would compute differently — the bands arrive already
classified by the app's own ladder at each school's own passing grade, which is
the point of exporting them rather than deriving them here.

    pip install pandas scikit-learn        # matplotlib optional, for the figure
    python research/analyze_observations.py
    python research/analyze_observations.py --in server/observations --out research/out
"""

import argparse
import os
import sys

try:
    import pandas as pd
    from sklearn.metrics import (
        accuracy_score,
        classification_report,
        confusion_matrix,
        cohen_kappa_score,
        f1_score,
    )
except ImportError as exc:  # pragma: no cover - environment guidance, not logic
    sys.exit(f"Missing dependency: {exc.name}. Run:  pip install pandas scikit-learn")


# The descriptor ladder, best to worst, exactly as grading.js orders it. Fixing
# the order here matters: scikit-learn otherwise sorts labels alphabetically, so
# the matrix's diagonal would run "failing, outstanding, passing..." and the
# off-diagonal cells would no longer show how far apart two judgements are.
BAND_ORDER = ["outstanding", "verySatisfactory", "satisfactory", "passing", "failing"]
BAND_LABELS = {
    "outstanding": "Outstanding (90-100)",
    "verySatisfactory": "Very Satisfactory (85-89)",
    "satisfactory": "Satisfactory (80-84)",
    "passing": "Fairly Satisfactory (75-79)",
    "failing": "Did Not Meet Expectations (<75)",
}


def rule(title=""):
    return f"\n{'=' * 72}\n{title}\n{'=' * 72}" if title else "=" * 72


def analyse_bands(df, out_lines):
    """Confusion matrix and classification metrics over the two band columns."""
    # The teacher's band is the reference: the human of record decides what the
    # paper is worth, and the model is measured against that decision — not the
    # other way round.
    y_true = df["teacherBand"]
    y_pred = df["aiBand"]

    # Only bands that actually occur. Passing an unused label to scikit-learn
    # yields a row and column of zeros and a 0.00 precision that reads as a
    # failure rather than as "no papers landed here".
    present = [b for b in BAND_ORDER if b in set(y_true) | set(y_pred)]

    matrix = confusion_matrix(y_true, y_pred, labels=present)
    out_lines.append(rule("CONFUSION MATRIX — rows: teacher (reference), columns: AI draft"))
    header = "".join(f"{b[:11]:>13}" for b in present)
    out_lines.append(f"{'':>32}{header}")
    for name, row in zip(present, matrix):
        cells = "".join(f"{int(v):>13}" for v in row)
        out_lines.append(f"{BAND_LABELS.get(name, name):>32}{cells}")

    out_lines.append(rule("CLASSIFICATION REPORT"))
    out_lines.append(
        classification_report(
            y_true,
            y_pred,
            labels=present,
            target_names=[BAND_LABELS.get(b, b) for b in present],
            # A band the AI never predicted would otherwise raise a warning and
            # print nan; 0 is the honest score for "predicted none of these".
            zero_division=0,
            digits=3,
        )
    )

    accuracy = accuracy_score(y_true, y_pred)
    macro_f1 = f1_score(y_true, y_pred, labels=present, average="macro", zero_division=0)
    # Agreement corrected for chance. Worth reporting alongside accuracy when
    # the bands are as unevenly filled as an Alpha set usually is: guessing the
    # largest band alone can score well on raw accuracy.
    kappa = cohen_kappa_score(y_true, y_pred, labels=present)

    out_lines.append(f"Accuracy          : {accuracy:.3f}")
    out_lines.append(f"Macro-averaged F1 : {macro_f1:.3f}")
    out_lines.append(f"Cohen's kappa     : {kappa:.3f}")

    # How far off the misses are, not just how many. A draft one band below the
    # teacher's is a different kind of error from one three bands below, and the
    # matrix shows it but no single metric does.
    rank = {b: i for i, b in enumerate(BAND_ORDER)}
    distance = (df["aiBand"].map(rank) - df["teacherBand"].map(rank)).abs()
    within_one = (distance <= 1).mean()
    out_lines.append(f"Exact band agreement            : {(distance == 0).mean():.1%}")
    out_lines.append(f"Within one band of the teacher  : {within_one:.1%}")

    out_lines.append("\nSupport per teacher-assigned band (read the per-band figures against this):")
    for band, count in df["teacherBand"].value_counts().reindex(present).dropna().items():
        out_lines.append(f"  {BAND_LABELS.get(band, band):<34} {int(count)}")

    return present, matrix


def analyse_scores(df, out_lines):
    """Signed and absolute difference, and what the teacher changed at review."""
    signed, absolute = df["signedDelta"], df["absDelta"]

    out_lines.append(rule("SCORE DIFFERENCE (teacher - AI, percentage points)"))
    out_lines.append(f"  papers                  : {len(df)}")
    # The sign is the interesting half: a mean near zero with a large spread is
    # an unbiased but noisy marker, while a consistently negative mean means the
    # model is marking harder than the teacher, which is a different problem.
    out_lines.append(f"  mean signed             : {signed.mean():+.2f}")
    out_lines.append(f"  median signed           : {signed.median():+.2f}")
    out_lines.append(f"  mean absolute           : {absolute.mean():.2f}")
    out_lines.append(f"  median absolute         : {absolute.median():.2f}")
    out_lines.append(f"  std dev (signed)        : {signed.std():.2f}")
    out_lines.append(f"  max absolute            : {absolute.max():.2f}")
    out_lines.append(f"  teacher scored higher   : {(signed > 0).sum()} ({(signed > 0).mean():.1%})")
    out_lines.append(f"  teacher scored lower    : {(signed < 0).sum()} ({(signed < 0).mean():.1%})")
    out_lines.append(f"  identical               : {(signed == 0).sum()} ({(signed == 0).mean():.1%})")

    out_lines.append(rule("HUMAN-IN-THE-LOOP OVERRIDE"))
    out_lines.append(f"  score changed at review : {df['scoreEdited'].sum()} ({df['scoreEdited'].mean():.1%})")
    if "feedbackEdited" in df and df["feedbackEdited"].notna().any():
        rate = df["feedbackEdited"].mean()
        out_lines.append(f"  feedback differs        : {int(df['feedbackEdited'].sum())} ({rate:.1%})")
        if rate > 0.98:
            # Said in the output, not just in a comment: a rate this high almost
            # certainly measures the save format rather than the teacher, and
            # reporting it as an override rate would overstate human correction.
            out_lines.append(
                "    ! at ~100% this is measuring how feedback is stored on save,\n"
                "      not how often a teacher rewrote it. Do not report it as an\n"
                "      override rate until the cause is established; the score\n"
                "      figure above is the defensible one."
            )
    out_lines.append(f"  released to students    : {df['released'].sum()} ({df['released'].mean():.1%})")

    if "secondsToValidation" in df:
        secs = df["secondsToValidation"].dropna()
        if len(secs):
            out_lines.append(
                f"  median time to review   : {secs.median():.0f}s "
                f"(p90 {secs.quantile(0.9):.0f}s) — a pair is only meaningful if a\n"
                "      human actually read the draft before deciding."
            )


def analyse_requests(path, out_lines):
    """Latency per request and consumption against the daily allowance."""
    out_lines.append(rule("PROVIDER REQUESTS"))
    if not os.path.exists(path):
        out_lines.append(f"  {path} not found - skipped.")
        return
    req = pd.read_csv(path)
    if req.empty:
        out_lines.append(
            "  No rows yet. AiRequestLog fills as grading runs on a server\n"
            "  running the instrumented build - deploy first, then re-export."
        )
        return

    req["createdAt"] = pd.to_datetime(req["createdAt"])
    out_lines.append(f"  requests logged         : {len(req)}")
    out_lines.append(f"  failed                  : {(~req['ok'].astype(bool)).sum()}")

    for purpose, group in req.groupby("purpose"):
        ok = group[group["ok"].astype(bool)]["latencyMs"]
        if ok.empty:
            out_lines.append(f"  {purpose:<10} {len(group):>4} requests, all failed")
            continue
        out_lines.append(
            f"  {purpose:<10} {len(group):>4} requests | latency ms "
            f"p50 {ok.quantile(0.5):.0f} | p95 {ok.quantile(0.95):.0f} | max {ok.max():.0f}"
        )

    out_lines.append("\n  Requests per day (this is the figure to compare against the daily allowance):")
    # Counted per attempt, which is what the provider counts: a retry spends a
    # second request, so counting papers would under-report consumption.
    for day, count in req.groupby(req["createdAt"].dt.date).size().items():
        out_lines.append(f"    {day}  {count}")

    if not req["ok"].astype(bool).all():
        out_lines.append("\n  Failures by outcome:")
        for outcome, count in req[~req["ok"].astype(bool)]["outcome"].value_counts().items():
            out_lines.append(f"    {outcome:<14} {count}")


def save_figure(present, matrix, out_dir):
    """Optional PNG of the matrix. Absent matplotlib is not an error."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from sklearn.metrics import ConfusionMatrixDisplay
    except ImportError:
        return None
    display = ConfusionMatrixDisplay(matrix, display_labels=[b for b in present])
    fig, ax = plt.subplots(figsize=(7, 6))
    display.plot(ax=ax, cmap="Blues", colorbar=False, values_format="d")
    ax.set_title("AI draft band vs teacher-validated band")
    ax.set_xlabel("AI draft")
    ax.set_ylabel("Teacher (reference)")
    plt.xticks(rotation=30, ha="right")
    plt.tight_layout()
    path = os.path.join(out_dir, "confusion-matrix.png")
    fig.savefig(path, dpi=200)
    plt.close(fig)
    return path


def main():
    # Windows consoles default to cp1252; the report is plain ASCII but a
    # stray character must not be able to kill a finished analysis.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    here = os.path.dirname(os.path.abspath(__file__))
    default_in = os.path.normpath(os.path.join(here, "..", "server", "observations"))

    parser = argparse.ArgumentParser(description="AM34.1 observation analysis")
    parser.add_argument("--in", dest="in_dir", default=default_in, help="directory holding the exported CSVs")
    parser.add_argument("--out", dest="out_dir", default=os.path.join(here, "out"), help="where to write the report")
    args = parser.parse_args()

    observations = os.path.join(args.in_dir, "grading-observations.csv")
    if not os.path.exists(observations):
        sys.exit(
            f"Not found: {observations}\n"
            "Run the exporter first:  cd server && npm run export:observations"
        )

    df = pd.read_csv(observations)
    if df.empty:
        sys.exit("The observations file has no rows — no paper has both an AI draft and a teacher decision yet.")

    os.makedirs(args.out_dir, exist_ok=True)
    lines = [
        "AM34.1 - AUTOMATED TECHNICAL OBSERVATION",
        f"source: {observations}",
        f"papers: {len(df)}",
    ]

    present, matrix = analyse_bands(df, lines)
    analyse_scores(df, lines)
    analyse_requests(os.path.join(args.in_dir, "ai-requests.csv"), lines)

    # The matrix as data, not just as printed text, so it can go into the paper
    # as a table without being retyped.
    pd.DataFrame(matrix, index=present, columns=present).to_csv(
        os.path.join(args.out_dir, "confusion-matrix.csv")
    )

    report = "\n".join(lines) + "\n"
    print(report)
    report_path = os.path.join(args.out_dir, "report.txt")
    with open(report_path, "w", encoding="utf-8") as handle:
        handle.write(report)

    figure = save_figure(present, matrix, args.out_dir)
    print(f"written: {report_path}")
    print(f"written: {os.path.join(args.out_dir, 'confusion-matrix.csv')}")
    print(f"written: {figure}" if figure else "(matplotlib not installed — no PNG figure)")


if __name__ == "__main__":
    main()
