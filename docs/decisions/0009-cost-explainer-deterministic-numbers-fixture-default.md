# 0009. Cost explainer: numbers in code, grounded model text, fixture mode by default

Status: accepted, pending maintainer review.

Three choices in piece 08 are not obvious.

Unexplained spend is defined in code: a week-over-week increase on a service that clears both a
dollar and a percent threshold and is not on the `EXPECTED_CHANGES` list. Anomaly Detection findings
are attached to the service rows but do not make an increase "explained", because an anomaly says
something is unusual, not that someone approved it. Decreases never count.

The model's summary is accepted only if its JSON validates and every `$` figure in it is a figure the
code computed (rounded to whole dollars also passes). This is stricter than schema validation alone
and catches the most damaging failure for a cost report, a plausible wrong number. It does not
catch a wrong percentage or a wrong cause; the prompt tells the model to put causes in an
assumptions list, and the message prints the computed numbers beside the prose. A failed check uses
the same retry and fallback as every other piece (the shared structured-output helper).

The Lambda defaults to fixture data (`DataSource=fixture`), with a fixed report date, so a first
deploy reports made-up numbers and touches no billing data. Live mode needs `DataSource=live`
exactly. The IAM role has the Cost Explorer read actions in both modes, because CloudFormation
conditions on policy statements add complexity for little gain; the function simply does not call
them in fixture mode.

Limits: the dollar check does not cover amounts written without a `$`, and Cost Explorer data is
revised after the fact, so a Monday report can differ slightly from the console on Wednesday.
