"""Mutation tests for input facts, independent HR authority and separate expectations."""

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from manual_marks import MARK_FILE, validate_manual_marks

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("workbook_checks", ROOT / "validate-workbooks.py")
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


def read(name):
    return json.loads((ROOT / name).read_text())


class ManualMarkFacts(unittest.TestCase):
    def setUp(self):
        self.inputs = read("seed-input.json")
        self.source = read(MARK_FILE)
        self.roster = read("roster.json")

    def validate(self):
        return validate_manual_marks(self.inputs, self.source, self.roster)

    def change(self, edit):
        edit(self.source["marks"][0])
        self.inputs["manualComparabilityMarks"] = copy.deepcopy(self.source["marks"])

    def test_positive_prototype_mark(self):
        self.assertEqual(set(self.validate()), {"bow-923-v3-case-042"})

    def test_missing_fact_collection(self):
        del self.inputs["manualComparabilityMarks"]
        with self.assertRaisesRegex(ValueError, "missing independent"):
            self.validate()

    def test_missing_one_seed_fact(self):
        self.inputs["manualComparabilityMarks"].pop()
        with self.assertRaisesRegex(ValueError, "differ from independent"):
            self.validate()

    def test_directory_evaluator_is_not_hr(self):
        teacher = next(actor for actor in self.roster["directory"] if actor["id"] == "s-04")
        self.change(lambda mark: mark.update(markedBy=teacher))
        with self.assertRaisesRegex(ValueError, "not the pinned demo HR"):
            self.validate()

    def test_forged_hr_name_or_role_is_rejected(self):
        self.source["actorAuthority"]["role"] = "mentor"
        with self.assertRaisesRegex(ValueError, "invalid pinned demo HR"):
            self.validate()

    def test_forged_actor_name_does_not_inherit_hr_id(self):
        self.change(lambda mark: mark["markedBy"].update(name="错误身份（演示）"))
        with self.assertRaisesRegex(ValueError, "not the pinned demo HR"):
            self.validate()

    def test_unknown_case_rejected(self):
        self.change(lambda mark: mark.update(caseId="bow-923-v3-case-999"))
        with self.assertRaisesRegex(ValueError, "unknown case"):
            self.validate()

    def test_known_case_with_wrong_mark_identity_rejected(self):
        self.change(lambda mark: mark.update(caseId="bow-923-v3-case-001"))
        with self.assertRaisesRegex(ValueError, "id/case mismatch"):
            self.validate()

    def test_cross_person_rejected(self):
        self.change(lambda mark: mark.update(personId="p-x01"))
        with self.assertRaisesRegex(ValueError, "person mismatch"):
            self.validate()

    def test_cross_batch_rejected(self):
        self.change(lambda mark: mark.update(batchId="another-batch"))
        with self.assertRaisesRegex(ValueError, "batch mismatch"):
            self.validate()

    def test_cross_node_rejected(self):
        self.change(lambda mark: mark.update(backNodeId="another-node"))
        with self.assertRaisesRegex(ValueError, "node pair mismatch"):
            self.validate()

    def test_duplicate_case_rejected(self):
        self.source["marks"].append(copy.deepcopy(self.source["marks"][0]))
        self.inputs["manualComparabilityMarks"] = copy.deepcopy(self.source["marks"])
        with self.assertRaisesRegex(ValueError, "duplicate manual mark"):
            self.validate()

    def test_blank_reason_rejected(self):
        self.change(lambda mark: mark.update(reason="   "))
        with self.assertRaisesRegex(ValueError, "needs a demo reason"):
            self.validate()

    def test_absent_reason_rejected(self):
        self.change(lambda mark: mark.pop("reason"))
        with self.assertRaisesRegex(ValueError, "unexpected manual mark fields"):
            self.validate()

    def test_invalid_or_unqualified_time_rejected(self):
        for value in ["not-a-date", "2026-06-15T01:00:00.000+08:00", "2026-02-30T01:00:00.000Z"]:
            with self.subTest(value=value):
                self.change(lambda mark: mark.update(markedAt=value))
                with self.assertRaisesRegex(ValueError, "timestamp"):
                    self.validate()

    def test_mark_cannot_predate_judgment(self):
        self.change(lambda mark: mark.update(markedAt="2026-02-01T01:00:00.000Z"))
        with self.assertRaisesRegex(ValueError, "predates judgment"):
            self.validate()

    def test_missing_stage_is_not_a_manual_exclusion(self):
        case = next(case for case in self.inputs["cases"] if case["id"] == "bow-923-v3-case-042")
        case["front"] = {"state": "missing", "reason": "演示缺段"}
        with self.assertRaisesRegex(ValueError, "disguise a missing stage"):
            self.validate()

    def test_outcomes_or_statistics_cannot_be_copied_into_seed(self):
        for key in ["outcome", "expectedOutcome", "counts", "distribution"]:
            with self.subTest(key=key):
                self.inputs["cases"][0][key] = {"copied": True}
                with self.assertRaisesRegex(ValueError, "computed result"):
                    self.validate()
                del self.inputs["cases"][0][key]

    def test_expected_cannot_fill_a_missing_manual_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(ROOT, root, dirs_exist_ok=True)
            data = self.inputs
            data["manualComparabilityMarks"].pop()
            (root / "seed-input.json").write_text(json.dumps(data, ensure_ascii=False))
            with self.assertRaisesRegex(ValueError, "differ from independent"):
                checks.validate(root)

    def test_rater_distribution_cannot_include_excluded_cases(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(ROOT, root, dirs_exist_ok=True)
            expected = read("expected-results.json")
            rater = next(entry for entry in expected["raters"] if "distribution" in entry["sample"])
            rater["sample"]["distribution"]["excluded"]["notComparable"] = 2
            (root / "expected-results.json").write_text(json.dumps(expected, ensure_ascii=False))
            with self.assertRaisesRegex(ValueError, "sample distribution"):
                checks.validate(root)

    def test_retargeting_an_existing_case_conflicts_with_the_separate_oracle(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(ROOT, root, dirs_exist_ok=True)
            case = self.inputs["cases"][0]
            self.change(lambda mark: mark.update(id="bow-923-v3-hr-mark-001", caseId=case["id"], personId=case["person"]["id"]))
            self.validate()  # Valid authored HR facts, but deliberately wrong scenario target.
            for name, data in [("seed-input.json", self.inputs), (MARK_FILE, self.source)]:
                (root / name).write_text(json.dumps(data, ensure_ascii=False))
            manifest = read("manifest.json")
            manifest["inputFacts"]["sha256"] = hashlib.sha256((root / MARK_FILE).read_bytes()).hexdigest()
            (root / "manifest.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "wrong case"):
                checks.validate(root)


if __name__ == "__main__":
    unittest.main()
