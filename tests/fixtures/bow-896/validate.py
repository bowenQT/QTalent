"""Inspect emitted fixture bytes, not the generator's in-memory objects."""

import argparse
import hashlib
import json
import re
import wave
import zipfile
from pathlib import Path

from PIL import Image, ImageChops
from pypdf import PdfReader
from pypdf.generic import ContentStream

ROOT = Path(__file__).resolve().parent


def read_json(name):
    return json.loads((ROOT / name).read_text(encoding="utf8"))


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def vector_circles(page, reader):
    """Read painted Bezier geometry and fill color from the PDF operator stream."""
    color, path, curves, output, stack = (0, 0, 0), [], 0, [], []
    for operands, op in ContentStream(page.get_contents(), reader).operations:
        if op == b"q":
            stack.append(color)
        elif op == b"Q" and stack:
            color = stack.pop()
        elif op == b"rg":
            color = tuple(float(x) for x in operands)
        elif op == b"n":
            path, curves = [], 0
        elif op == b"m":
            path.append(tuple(float(x) for x in operands))
        elif op == b"c":
            values = [float(x) for x in operands]
            path += list(zip(values[0::2], values[1::2]))
            curves += 1
        elif op in (b"B", b"B*", b"f", b"f*"):
            if curves == 4 and path:
                xs, ys = zip(*path)
                width, height = max(xs) - min(xs), max(ys) - min(ys)
                if abs(width - 10) < 0.02 and abs(height - 10) < 0.02:
                    output.append({"x": (max(xs) + min(xs)) / 2,
                                   "top": float(page.mediabox.height) - (max(ys) + min(ys)) / 2,
                                   "color": color})
            path, curves = [], 0
    return output


def check_pdf(path):
    reader = PdfReader(path)
    check(not reader.is_encrypted, str(path) + ": encrypted")
    check(reader.metadata.get("/Author") == "Niu-Talent Demo", str(path) + ": author")
    check(reader.metadata.get("/Creator") == "BOW-896 fixture builder", str(path) + ": creator")
    check("20000101" in reader.metadata.get("/CreationDate", ""), str(path) + ": clock metadata")
    check("/AcroForm" not in reader.trailer["/Root"], str(path) + ": unexpected form payload")
    check(not list(reader.attachments), str(path) + ": embedded attachment")
    metadata = str(reader.metadata)
    content = "\n".join(page.extract_text() or "" for page in reader.pages)
    check("演示" in content and "�" not in content, str(path) + ": broken or missing Chinese text layer")
    check(not re.search(r"/Users/|/home/|file://|[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}", metadata + content), str(path) + ": private location/contact")
    check(not re.search(r"●|◉|☑|✓", content), str(path) + ": selection leaked into text")
    return reader, content


def check_interviews(manifest):
    cases = manifest["interviewCases"]
    check(len(cases) == 8, "eight distinct PDF scenarios")
    literal_expectations = {"campus": [2, 4, 3], "hr": [3, 2, 4], "professional": [4, 3, 5]}
    directory = {p["id"]: p["name"] for p in read_json("directory.json")["people"]}
    for case in cases:
        reader, content = check_pdf(ROOT / case["file"])
        check(len(reader.pages) == case["pages"], case["id"] + ": page count")
        check(case["template"] in content, case["id"] + ": title")
        check(case["interviewerDisplayName"] in content, case["id"] + ": interviewer")
        if case["interviewerPersonId"] is not None:
            check(directory[case["interviewerPersonId"]] in case["interviewerDisplayName"], "interviewer directory identity")
        else:
            check(case["id"] == "unknown-interviewer", "only one intentional unknown interviewer")
        check(content.count("明细评价（整张评价表）") == 1, case["id"] + ": detail marker")
        for row in case["rows"]:
            page = reader.pages[row["page"] - 1]
            check(row["label"] in page.extract_text(), case["id"] + ": row page")
            circles = vector_circles(page, reader)
            for option in row["options"]:
                x0, y0, x1, y1 = option["bbox"]
                check(0 <= x0 < x1 <= 595.276 and 0 <= y0 < y1 <= 841.89, "bounded citation")
                matches = [circle for circle in circles if abs(circle["x"] - (x0 + x1) / 2) < 0.02 and abs(circle["top"] - (y0 + y1) / 2) < 0.02]
                check(len(matches) == 1, case["id"] + ": expected one vector circle at " + str(option["bbox"]))
                expected = (0.16, 0.48, 0.90) if option["selected"] else (1, 1, 1)
                check(all(abs(a - b) < 0.001 for a, b in zip(matches[0]["color"], expected)), case["id"] + ": vector selection color")
            selected = sum(option["selected"] for option in row["options"])
            if row["recognition"] == "recognized":
                check(selected == 1, case["id"] + ": exactly one selection")
            elif row["recognition"] == "not_applicable":
                check(row["label"] == "管理能力" and selected == 0, "management N/A")
            else:
                check(selected != 1 and case["id"] in ("score-missing", "score-multiple"), "intentional ambiguous score")
        if case["id"] in literal_expectations:
            check([row["expected"] for row in case["rows"][:3]] == literal_expectations[case["id"]], case["id"] + ": canonical scores")
        if case["id"] == "hr":
            check(case["rows"][-1]["label"] == "建议职级" and case["rows"][-1]["page"] == 3, "HR grade overflow")
        quote = case["comment"]["quote"]
        page_text = reader.pages[case["comment"]["page"] - 1].extract_text().replace("\n", "")
        check(quote in page_text, case["id"] + ": quotation in detail text layer")
    a = (ROOT / manifest["duplicateImport"]["original"]).read_bytes()
    b = (ROOT / manifest["duplicateImport"]["duplicate"]).read_bytes()
    check(a == b, "duplicate import uses byte-identical file")
    candidates = read_json("candidates.json")["rows"]
    check(len(candidates) == 4, "four separate candidate acceptance rows")
    check(sum(row["expectedAction"] == "import" for row in candidates) == 1, "one hired candidate")
    check(sum(row["expectedAction"] == "skip" for row in candidates) == 3, "three skipped candidates")
    check(candidates[1]["directoryPersonId"] is not None, "rejected person must still be skipped even if in directory")
    return {"pdfScenarios": len(cases), "pdfFilesIncludingDuplicate": len(cases) + 1, "candidateRows": 4}


def check_other_assets():
    raw = Image.open(ROOT / "screenshots/mixed-permissions.png")
    safe = Image.open(ROOT / "screenshots/mentor-filtered.png")
    check(raw.size == safe.size == (1080, 1280), "screenshot dimensions")
    check(not raw.getexif() and not safe.getexif(), "screenshot EXIF")
    expected = read_json("screenshots/expected.json")
    for region in expected["regions"]:
        different = ImageChops.difference(raw.crop(region["bboxPixels"]), safe.crop(region["bboxPixels"])).getbbox() is not None
        check(different == (region["id"] == "chat-private"), "redaction affects exactly the private message")
    check("mentor" not in expected["regions"][1]["allowedRoles"], "mixed permission case")
    with wave.open(str(ROOT / "audio/mentor-note.wav")) as audio:
        check((audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) == (1, 2, 16000), "PCM audio format")
        duration = audio.getnframes() * 1000 / audio.getframerate()
        check(abs(duration - read_json("audio/expected.json")["durationMs"]) < 1, "audio timing")
        pcm = audio.readframes(audio.getnframes())
        check(any(pcm), "non-silent speech bytes")
        check(duration > 10000, "spoken sample duration")
        previous_end = 0
        for segment in read_json("audio/expected.json")["segments"]:
            check(previous_end <= segment["startMs"] < segment["endMs"] <= duration, "nonempty ordered audio citations")
            previous_end = segment["endMs"]
    with zipfile.ZipFile(ROOT / "defense/project-defense.pptx") as pptx:
        slides = [name for name in pptx.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)]
        check(len(slides) == 2, "two editable PPT slides")
        slide_text = "".join(pptx.read(name).decode("utf8") for name in slides)
        check("片段重试" in slide_text and "缓存回收" in slide_text and "谷嘉树（演示）" in slide_text, "PPT text is editable and synthetic")
        core = pptx.read("docProps/core.xml").decode("utf8")
        check("Niu-Talent Demo" in core and "/Users/" not in core, "PPT metadata")
        for name in pptx.namelist():
            if name.endswith(".rels"):
                check(b'TargetMode="External"' not in pptx.read(name), "PPT must not link out to private assets")
    for name in ("defense/project-defense.pdf", "defense/formal-review.pdf"):
        check_pdf(ROOT / name)
    expected = read_json("defense/expected.json")
    check(expected["expectedEventCount"] == 2 and len(expected["eventClusters"]) == 2, "same person, two distinct events")
    check(expected["eventClusters"][0]["personId"] == expected["eventClusters"][1]["personId"], "same-person counterexample")
    for cluster in expected["eventClusters"]:
        check(len(cluster["evidence"]) == 4, "four sources per event")
        for evidence in cluster["evidence"]:
            check((ROOT / "defense" / evidence["file"]).is_file(), "source must open")
    return {"screenshots": 2, "audioDurationMs": int(duration), "editableSlides": 2, "distinctEvents": 2}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-only", action="store_true")
    args = parser.parse_args()
    manifest = read_json("manifest.json")
    for item in manifest["assets"]:
        path = ROOT / item["file"]
        check(hashlib.sha256(path.read_bytes()).hexdigest() == item["sha256"], "asset hash " + item["file"])
        check(path.stat().st_size == item["bytes"], "asset bytes " + item["file"])
    result = check_interviews(manifest)
    if not args.pdf_only:
        result.update(check_other_assets())
    print(json.dumps({"result": "pass", "checks": result, "limits": ["official template layout not certified", "parser/importer and supplier transcription not run"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
