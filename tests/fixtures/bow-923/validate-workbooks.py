"""Read saved XLSX bytes independently; never creates or edits a workbook."""

import argparse
import csv
import hashlib
import io
import json
import re
import zipfile
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

from manual_marks import FIXTURE_VERSION, MARK_FILE, validate_manual_marks

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
FRONT_HEADERS = [
    "人员ID", "学员（演示）", "期次（演示）", "作品ID", "作品形式", "同队标记",
    "作品完整度与创新性（原档位）", "开发过程与质量（原档位）", "演示与表达（原档位）",
    "选拔原档位", "评价人ID", "评价人（演示）", "评价时间（UTC）", "选拔标准版本",
    "记录状态", "重建评语（演示）",
]
BACK_HEADERS = [
    "人员ID", "学员（演示）", "期次（演示）", "结营原档位", "评价人ID", "评价人（演示）",
    "评价时间（UTC）", "结营原量表ID", "记录状态", "重建评语（演示）",
]
ALLOWED_ENTRIES = {
    "xl/workbook.xml", "xl/styles.xml", "xl/theme/theme1.xml", "xl/sharedStrings.xml",
    "xl/worksheets/sheet1.xml", "xl/tables/table1.xml", "_rels/.rels",
    "xl/_rels/workbook.xml.rels", "xl/worksheets/_rels/sheet1.xml.rels", "[Content_Types].xml",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(root, name):
    return json.loads((root / name).read_text())


def read_xlsx(file):
    blob = file.read_bytes()
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        require(set(archive.namelist()) == ALLOWED_ENTRIES, f"unexpected/hidden metadata entries: {file.name}")
        entries = {name: archive.read(name) for name in archive.namelist()}
    for name, content in entries.items():
        require(b"/Users/" not in content and b"file://" not in content, f"private path in {name}")
        root = ET.fromstring(content)
        require(not any(node.attrib.get("TargetMode") == "External" for node in root.iter()), f"external relationship: {name}")
    strings = ["".join(node.itertext()) for node in ET.fromstring(entries["xl/sharedStrings.xml"]).findall("m:si", NS)]
    book = ET.fromstring(entries["xl/workbook.xml"])
    sheets = book.findall("m:sheets/m:sheet", NS)
    require(len(sheets) == 1 and sheets[0].get("state", "visible") == "visible", "expected one visible sheet")
    sheet = ET.fromstring(entries["xl/worksheets/sheet1.xml"])
    require(not sheet.findall(".//m:f", NS), "formula in original table")
    require(not sheet.findall(".//m:hyperlink", NS), "unexpected hyperlink")
    require(not any(node.get("hidden") in ("1", "true") for node in sheet.iter()), "hidden row or column")
    cells, types, styles = {}, {}, {}
    for cell in sheet.findall("m:sheetData/m:row/m:c", NS):
        address, kind = cell.attrib["r"], cell.get("t", "n")
        require(kind != "e", f"Excel error at {address}")
        value = cell.find("m:v", NS)
        if kind == "s":
            decoded = strings[int(value.text)]
        elif kind == "inlineStr":
            decoded = "".join(cell.find("m:is", NS).itertext())
        elif kind == "str":
            decoded = value.text if value is not None else None
        else:
            decoded = None if value is None or value.text is None else float(value.text)
        cells[address], types[address], styles[address] = decoded, kind, cell.get("s", "0")
    styles_xml = ET.fromstring(entries["xl/styles.xml"])
    formats = {node.get("numFmtId"): node.get("formatCode") for node in styles_xml.findall("m:numFmts/m:numFmt", NS)}
    xfs = styles_xml.findall("m:cellXfs/m:xf", NS)
    return {"blob": blob, "strings": strings, "sheet": sheets[0].get("name"), "cells": cells, "types": types,
            "date_formats": {address: formats.get(xfs[int(style)].get("numFmtId"), "") for address, style in styles.items()}}


def check_date(book, address, iso):
    value = book["cells"].get(address)
    require(book["types"].get(address) == "n" and isinstance(value, (int, float)), f"date must be numeric at {address}")
    require("yyyy-mm-dd" in book["date_formats"][address], f"missing date display format at {address}")
    actual = datetime(1899, 12, 30, tzinfo=timezone.utc) + timedelta(days=value)
    expected = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    require(abs((actual - expected).total_seconds()) < 0.001, f"wrong UTC date at {address}")


def summarize_declared_outcomes(cases):
    """Only total the authored labels; this never classifies real judgments."""
    states = Counter(case["outcome"]["state"] for case in cases)
    middle = Counter(case["outcome"]["backGrade"] for case in cases if case["outcome"]["state"] == "middle_distribution")
    missing = Counter(case["outcome"]["missing"] for case in cases if case["outcome"]["state"] == "missing")
    return {
        "clear": {"consistent": states["consistent"], "frontHigher": states["front_higher"], "frontLower": states["front_lower"]},
        "middleDistribution": {"notRecommended": middle["不建议"], "observe": middle["继续观察"], "recommended": middle["建议留用"]},
        "excluded": {"missingFront": missing["front"], "missingBack": missing["back"], "missingBoth": missing["both"], "notComparable": states["not_comparable"]},
    }


def validate(root):
    manifest, roster = read_json(root, "manifest.json"), read_json(root, "roster.json")
    inputs = read_json(root, "seed-input.json")
    source = read_json(root, MARK_FILE)
    marks = validate_manual_marks(inputs, source, roster)
    require(manifest["fixtureVersion"] == FIXTURE_VERSION, "manifest input version mismatch")
    require(manifest["inputFacts"] == {"file": MARK_FILE, "nature": "demo_human_mark", "records": 4, "sha256": hashlib.sha256((root / MARK_FILE).read_bytes()).hexdigest()}, "manual fact source manifest mismatch")
    outcomes, locators = read_json(root, "expected-cases.json"), read_json(root, "source-rows.json")
    require(all("outcome" not in unit for unit in inputs["cases"]), "seed input contains a computed result")
    expected_by_id = {entry["caseId"]: entry for entry in outcomes}
    require(len(expected_by_id) == len(inputs["cases"]) == 93, "duplicate/missing expected case")
    cases = []
    for unit in inputs["cases"]:
        entry = expected_by_id[unit["id"]]
        require(entry["personId"] == unit["person"]["id"], "expectation attached to wrong person")
        outcome = entry["expectedOutcome"]
        mark = marks.get(unit["id"])
        require((outcome["state"] == "not_comparable") == (mark is not None), "expected manual exclusion lacks input fact or targets wrong case")
        if mark is not None:
            require(outcome == {"state": "not_comparable", **{key: mark[key] for key in ("reason", "markedBy", "markedAt")}}, "expected manual metadata differs from independent input")
        cases.append({**unit, "outcome": outcome})
    expected = read_json(root, "expected-results.json")
    require(manifest["evidenceStatus"] == expected["evidenceStatus"] == "expected_only_actual_query_not_run", "must not claim actual query")
    require(len(cases) == len(locators) == len(roster["students"]) == 93, "expected all 93 admitted demo students")
    require(len({person["id"] for person in roster["students"]}) == 93, "duplicate roster person")
    directory = {person["id"]: person["name"] for person in roster["directory"]}
    standard = read_json(root, "selection-standard.json")
    require(len(inputs["selectionReviews"]) == 93, "missing original review-point grades")
    require(all(person["name"].endswith("（演示）") for person in roster["students"] + roster["directory"]), "unmarked demo identity")
    fragments = []
    reports = []
    for side, headers in (("front", FRONT_HEADERS), ("back", BACK_HEADERS)):
        source = manifest["originals"][side]
        book = read_xlsx(root / source["file"])
        require(hashlib.sha256(book["blob"]).hexdigest() == source["sha256"], "original file digest changed")
        require(book["sheet"] == source["sheet"], "source sheet mismatch")
        allowed_text = set(headers)
        for column, heading in enumerate(headers):
            require(book["cells"].get(f"{chr(65 + column)}1") == heading, "header changed")
        present = 0
        for index, (case, locations, person) in enumerate(zip(cases, locators, roster["students"], strict=True)):
            row = index + 2
            require(case["person"] == person and locations["personId"] == person["id"], "person order mismatch")
            locator = locations[side]
            require(locator["personId"] == person["id"] and locator["row"] == row, "source row shifted to another person")
            citation = locator["source"]
            require(citation["originalVersionId"] == source["originalVersionId"] and citation["demo"] is True, "borrowed source original")
            require(citation["sourceCategory"] == "original" and citation["sourceType"] == "spreadsheet", "snapshot relabeled as original")
            require(citation["location"] == {"kind": "spreadsheet", "sheet": source["sheet"], "cell": f"A{row}:{source['lastColumn']}{row}"}, "source range not this person's row")
            fragments.append(citation["fragmentId"])
            require(book["cells"].get(f"{source['excerptColumn']}{row}") == citation["excerpt"], "quote differs from saved XLSX")
            require(citation["excerpt"].startswith("演示重建："), "unmarked synthetic comment")
            values = {"A": person["id"], "B": person["name"], "C": case["cohort"]["name"]}
            stage = case[side]
            date_column = source["dateColumn"]
            if side == "front":
                review = inputs["selectionReviews"][index]
                require(review["personId"] == person["id"], "criterion grades attached to wrong person")
                require([item["reviewPointId"] for item in review["originalGrades"]] == [point["id"] for point in standard["reviewPoints"]], "criterion references changed")
                work = case["work"]
                values.update({"D": work["workId"], "E": "组队作品" if work["kind"] == "team" else "个人作品",
                               "F": "轨道队（演示）" if work["kind"] == "team" else None,
                               "N": case["selectionStandardVersionId"], "P": citation["excerpt"]})
                values.update({column: item["grade"] for column, item in zip("GHI", review["originalGrades"], strict=True)})
                grade_column, rater_id, rater_name, status_column = "J", "K", "L", "O"
            else:
                values.update({"H": expected["mapping"]["backScaleId"], "J": citation["excerpt"]})
                grade_column, rater_id, rater_name, status_column = "D", "E", "F", "I"
            if stage["state"] == "present":
                judgment = stage["judgment"]
                require(judgment["row"] == locator, "judgment citation differs from source registry")
                rater = judgment["evaluator"]
                require(directory.get(rater["id"]) == rater["name"], "evaluator outside demo directory")
                values.update({grade_column: judgment["grade"], rater_id: rater["id"], rater_name: rater["name"], status_column: "已确认（演示）"})
                check_date(book, f"{date_column}{row}", judgment["evaluatedAt"])
                present += 1
                if side == "front":
                    for column in "GHI":
                        require(book["cells"].get(f"{column}{row}") in ("高分档", "中间档", "刚过线档"), "invalid original criterion band")
                        allowed_text.add(book["cells"][f"{column}{row}"])
            else:
                values.update({grade_column: None, rater_id: None, rater_name: None, status_column: "缺段", date_column: None})
                if side == "front":
                    values.update({column: None for column in "GHI"})
            for column, value in values.items():
                require(book["cells"].get(f"{column}{row}") == value, f"unexpected value {side} {column}{row}")
                if isinstance(value, str):
                    allowed_text.add(value)
        require(present == source["presentEvaluations"], "wrong present-evaluation count")
        require(set(book["strings"]) <= allowed_text, "unused/foreign text in XLSX shared strings")
        require(all(re.fullmatch(r"[A-P](?:[1-9]|[1-8][0-9]|9[0-4])", address) if side == "front" else re.fullmatch(r"[A-J](?:[1-9]|[1-8][0-9]|9[0-4])", address) for address in book["cells"]), "extra cells outside source rectangle")
        reports.append({"file": source["file"], "sha256": source["sha256"], "people": 93, "typedDates": present, "foreignText": 0,
                        "formulas": 0, "hiddenMetadata": 0, "sourceRowsVerified": 93})
    require(len(set(fragments)) == 186, "duplicate source fragment across originals")
    require(manifest["originals"]["front"]["originalVersionId"] != manifest["originals"]["back"]["originalVersionId"], "shared original version")
    counts = Counter(case["outcome"]["state"] for case in cases)
    require(dict(counts) == {"front_higher": 5, "front_lower": 3, "middle_distribution": 54, "consistent": 16, "missing": 11, "not_comparable": 4}, "authored case controls changed")
    require(summarize_declared_outcomes(cases) == expected["counts"], "declared summary differs from expected-case labels")
    require(expected["controls"] == {"people": 93, "frontPresent": 87, "backPresent": 86, "comparable": 78, "sameTeamPeople": 2}, "fixed scenario controls changed")
    require(expected["middleBand"] == {"countsForMismatch": False, "countsForComparableThreshold": True}, "middle-band definitions conflated")
    for entry in expected["raters"]:
        evaluator, sample = entry["evaluator"], entry["sample"]
        ids = [case["id"] for case in cases if case["front"]["state"] == "present" and case["front"]["judgment"]["evaluator"]["id"] == evaluator["id"] and case["outcome"]["state"] not in ("missing", "not_comparable")]
        require(ids == sample["caseIds"] and len(ids) == sample["comparableCaseCount"], "rater sample includes missing/incomparable or omits middle")
        require((len(ids) >= 5) == (sample["state"] == "sufficient_sample"), "wrong threshold state")
        require(len(ids) >= 5 or (sample["label"] == "样本不足" and "distribution" not in sample), "insufficient sample leaks distribution")
        if len(ids) >= 5:
            own = [case for case in cases if case["id"] in sample["caseIds"]]
            require(sample["distribution"]["excluded"] == {"missingFront": 0, "missingBack": 0, "missingBoth": 0, "notComparable": 0}, "sample distribution must exclude all non-comparable cases")
            require(summarize_declared_outcomes(own) == sample["distribution"], "rater expected distribution differs from own declared labels")
    with (root / "expected-cases.csv").open(newline="") as file:
        csv_rows = list(csv.DictReader(file))
    require(len(csv_rows) == 93, "CSV expected-case table incomplete")
    for row, case, sources in zip(csv_rows, cases, locators, strict=True):
        require(row == {
            "案例ID": case["id"], "人员ID": case["person"]["id"], "学员（演示）": case["person"]["name"],
            "前段原档位": case["front"]["judgment"]["grade"] if case["front"]["state"] == "present" else "",
            "后段原档位": case["back"]["judgment"]["grade"] if case["back"]["state"] == "present" else "",
            "预期类别（非查询结果）": case["outcome"]["state"], "档差": str(case["outcome"].get("bands", "")),
            "计入不一致": "是" if case["outcome"]["state"] in ("front_higher", "front_lower") else "否",
            "计入可对照样本": "否" if case["outcome"]["state"] in ("missing", "not_comparable") else "是",
            "前段评价人ID": case["front"]["judgment"]["evaluator"]["id"] if case["front"]["state"] == "present" else "",
            "同队ID": case["work"].get("teamId", ""),
            "前段行": sources["front"]["source"]["location"]["cell"], "后段行": sources["back"]["source"]["location"]["cell"],
        }, "CSV case expectation or row reference changed")
    scenario = read_json(root, "cohort-scenarios.json")
    require(scenario["liveScenario"]["beforeCreation"] == {"cohortExists": False, "boundVersionId": None}, "seventh cohort pre-bound before publication")
    require(scenario["fixedBackground"][0]["boundSelectionVersionId"] == "xe-select-v1", "sixth cohort history changed")
    return {"manualMarks": {"records": len(marks), "inputVersion": FIXTURE_VERSION, "nature": "demo_human_mark"}, "status": "fixture_bytes_and_expectations_verified", "actualQuery": "not_run", "originalReadAPI": "not_run", "databaseIdempotency": "not_run", "originals": reports}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = json.dumps(validate(args.root), ensure_ascii=False, indent=2)
    if args.report:
        args.report.write_text(result + "\n")
    print(result)
