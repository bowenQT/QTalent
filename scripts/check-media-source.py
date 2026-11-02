#!/usr/bin/env python3
"""Check madison's exact version and the runner's fixed Ubuntu mirror wrapper."""
import json
from pathlib import Path
import re
import stat
import sys

MIRROR = "mirror+file:/etc/apt/apt-mirrors.txt"
KEYRING = "/usr/share/keyrings/ubuntu-archive-keyring.gpg"
OFFICIAL = re.compile(r"https?://(?:[a-z0-9-]+\.)*archive\.ubuntu\.com/ubuntu/?|https?://security\.ubuntu\.com/ubuntu/?")


def mirrors_valid(text):
    urls = [line.split("\t", 1)[0] for line in text.splitlines()
            if line.strip() and not line.startswith("#")]
    return bool(urls) and all(OFFICIAL.fullmatch(url) for url in urls)


def signed_wrapper_valid(text):
    # Deb822, including folded values; duplicate fields fail closed.
    stanzas, fields, previous = [], {}, None
    for line in [*text.splitlines(), ""]:
        if not line.strip():
            if fields:
                stanzas.append(fields)
            fields, previous = {}, None
        elif line.startswith("#"):
            continue
        elif line[0].isspace() and previous:
            fields[previous] += " " + line.strip()
        elif ":" in line:
            name, value = line.split(":", 1)
            name = name.lower()
            if name in fields:
                return False
            fields[name], previous = value.strip(), name
        else:
            return False
    active = [s for s in stanzas if MIRROR in s.get("uris", "").split()
              and s.get("enabled", "yes").lower() != "no"]
    return bool(active) and all(
        s.get("signed-by") == KEYRING
        and "deb" in s.get("types", "").split()
        and not any(s.get(k, "no").lower() != "no"
                    for k in ("trusted", "allow-insecure", "allow-weak", "allow-downgrade-to-insecure"))
        for s in active
    )


def protected_file(path):
    p = Path(path)
    info = p.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError("source configuration is not a protected root-owned regular file")
    return p


def runner_wrapper_checks():
    # Only fixed boolean checks are public diagnostics; never print file contents.
    checks = {}
    for label, path, validator in (
        ("keyring", KEYRING, None),
        ("mirrorlist", "/etc/apt/apt-mirrors.txt", mirrors_valid),
        ("sources", "/etc/apt/sources.list.d/ubuntu.sources", signed_wrapper_valid),
    ):
        checks[label + "_protected"] = False
        if validator:
            checks[label + "_valid"] = False
        try:
            file = protected_file(path)
            checks[label + "_protected"] = True
            if validator:
                checks[label + "_valid"] = bool(validator(file.read_text()))
        except (OSError, UnicodeError, ValueError):
            pass
    return checks


def runner_wrapper_valid():
    return all(runner_wrapper_checks().values())


def check(text, expected, wrapper_check=runner_wrapper_valid):
    matching = []
    for line in text.splitlines():
        row = [value.strip() for value in line.split("|")]
        if len(row) == 3 and row[1] == expected:
            matching.append(row[2].split()[0] if row[2].split() else "")
    wrapped = MIRROR in matching
    wrapper_ok = wrapper_check() if wrapped else False
    # Reject competing nonofficial origins for this same version, too.
    official = bool(matching) and all(OFFICIAL.fullmatch(uri) or (uri == MIRROR and wrapper_ok)
                                      for uri in matching)
    return {"version_present": bool(matching), "official_source": bool(official),
            "mirror_wrapper_present": wrapped, "mirror_wrapper_verified": bool(wrapper_ok)}


if __name__ == "__main__":
    result = check(sys.stdin.read(), sys.argv[2])
    if result["mirror_wrapper_present"]:
        result.update(runner_wrapper_checks())
        # Diagnose only the fixed public Ubuntu keyring metadata, not its bytes.
        try:
            keyring = Path(KEYRING).lstat()
            result.update(keyring_exists=True,
                          keyring_regular=stat.S_ISREG(keyring.st_mode),
                          keyring_symlink=stat.S_ISLNK(keyring.st_mode),
                          keyring_root_owned=keyring.st_uid == 0,
                          keyring_group_or_world_writable=bool(keyring.st_mode & 0o022))
        except OSError:
            result["keyring_exists"] = False
    print(json.dumps({"package": sys.argv[1], "expected_version": sys.argv[2], **result}, sort_keys=True))
    if not result["version_present"]:
        sys.exit("Fixed Ubuntu package version unavailable; refusing substitution")
    if not result["official_source"]:
        sys.exit("Fixed package origin unverified; refusing installation")
