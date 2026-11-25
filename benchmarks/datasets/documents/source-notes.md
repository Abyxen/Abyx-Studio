# Synthetic technical notes

The sample service stores event durations in milliseconds. A successful test is represented by `ok: true`. Failed events must remain in the report; they must not be silently discarded.

Known requirement: when computing an average duration, include only numeric duration values and state how failed events were handled. This is synthetic benchmark content, not user data.
