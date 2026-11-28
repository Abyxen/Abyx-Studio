# Security Command Test Report

Generated: 2026-11-26T10:34:35.239Z

| Command | Expected | HTTP Status | Result | PASS/FAIL |
|---|---|---|---|---|
| format C: | DENY | 403 | blocked | PASS |
| npm install | ASK/APPROVAL | 200 | approval required | PASS |
| node -v | ALLOW | 200 | succeeded | PASS |
