"""Validate authored demo HR facts without reading any expected outcome or counts."""

import re
from datetime import datetime

FIXTURE_VERSION = "bow-923-v2"
MARK_FILE = "manual-comparability-marks.json"
ROLE_PROVENANCE = {
    "commit": "451ecec0106344cac2e4225a363b5fd3cae92584",
    "path": "prototype/y/app/js/data.js",
    "blob": "48cacc14105d496159e633dd392128629f03e3f9",
    "roleKey": "ROLES.hrbp",
}
FORBIDDEN_RESULTS = {"outcome", "expectedOutcome", "expectedResults", "counts", "distribution", "comparableCaseCount", "bands"}
MARK_KEYS = {"id", "nature", "caseId", "batchId", "personId", "frontNodeId", "backNodeId", "reason", "markedBy", "markedAt"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def reject_results(value):
    if isinstance(value, dict):
        require(not (set(value) & FORBIDDEN_RESULTS), "computed result in seed/manual input")
        for item in value.values():
            reject_results(item)
    elif isinstance(value, list):
        for item in value:
            reject_results(item)


def utc_time(value):
    require(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value), "manual mark timestamp must be explicit UTC")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("invalid manual mark timestamp") from error


def validate_manual_marks(inputs, source, roster):
    require("manualComparabilityMarks" in inputs, "seed missing independent manual comparability marks")
    reject_results(inputs)
    reject_results(source)
    require(set(inputs) == {"fixtureVersion", "demo", "contractSha", "notice", "batch", "selectionReviews", "manualComparabilityMarks", "cases"}, "unexpected seed input fields")
    require(set(source) == {"fixtureVersion", "demo", "notice", "scenarioProvenance", "actorAuthority", "marks"}, "unexpected manual source fields")
    require(inputs["fixtureVersion"] == source["fixtureVersion"] == FIXTURE_VERSION, "wrong seed/manual input version")
    require(inputs["demo"] is True and source["demo"] is True, "manual marks must be demo facts")
    directory = {person["id"]: person for person in roster["directory"]}
    # Pinned Y data.js defines ROLES.hrbp.person=p-suwan; directory membership alone
    # does not make other evaluators HR. This is fixture authority, not live auth.
    hr = directory.get("p-suwan")
    require(hr is not None and hr["name"].endswith("（演示）"), "pinned demo HR absent")
    require(source["actorAuthority"] == {"person": hr, "role": "hrbp", "provenance": ROLE_PROVENANCE}, "invalid pinned demo HR authority")
    cases = {case["id"]: case for case in inputs["cases"]}
    require(len(cases) == len(inputs["cases"]), "duplicate input case")
    marks = source["marks"]
    require(isinstance(marks, list) and len(marks) == 4, "expected four authored manual facts")
    require(inputs["manualComparabilityMarks"] == marks, "seed marks differ from independent authored facts")
    by_case, seen_ids = {}, set()
    for mark in marks:
        require(set(mark) == MARK_KEYS, "unexpected manual mark fields")
        require(mark["nature"] == "demo_human_mark", "manual mark must retain demo human provenance")
        case = cases.get(mark["caseId"])
        require(case is not None, "manual mark targets unknown case")
        require(mark["caseId"] not in by_case and mark["id"] not in seen_ids, "duplicate manual mark identity/case")
        require(mark["id"] == "bow-923-hr-mark-" + mark["caseId"].removeprefix("bow-923-case-"), "manual mark id/case mismatch")
        require(mark["batchId"] == case["batchId"] == inputs["batch"]["id"], "manual mark batch mismatch")
        require(mark["personId"] == case["person"]["id"], "manual mark person mismatch")
        require(mark["frontNodeId"] == case["frontNodeId"] and mark["backNodeId"] == case["backNodeId"], "manual mark node pair mismatch")
        require(mark["markedBy"] == hr, "manual marker is not the pinned demo HR")
        require(isinstance(mark["reason"], str) and mark["reason"].strip() and "演示" in mark["reason"], "manual mark needs a demo reason")
        marked_at = utc_time(mark["markedAt"])
        for side in ("front", "back"):
            require(case[side]["state"] == "present", "manual mark cannot disguise a missing stage")
            require(marked_at >= utc_time(case[side]["judgment"]["evaluatedAt"]), "manual mark predates judgment")
        by_case[mark["caseId"]] = mark
        seen_ids.add(mark["id"])
    return by_case
