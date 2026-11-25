package workflows

# PG004: actions and reusable workflows pinned by commit SHA.

# Every `uses:` value in the workflow, with where it was found.
uses_refs contains [loc, ref] if {
	some job_id, job in input.jobs
	ref := job.uses
	loc := sprintf("jobs.%s", [job_id])
}

uses_refs contains [loc, ref] if {
	some job_id, job in input.jobs
	some i, step in job.steps
	ref := step.uses
	loc := sprintf("jobs.%s.steps[%d]", [job_id, i])
}

unpinned(ref) if {
	not startswith(ref, "./")
	not startswith(ref, "docker://")
	not regex.match(`@[0-9a-f]{40}$`, ref)
}

unpinned(ref) if {
	startswith(ref, "docker://")
	not regex.match(`@sha256:[0-9a-f]{64}$`, ref)
}

deny contains msg if {
	some [loc, ref] in uses_refs
	unpinned(ref)
	msg := sprintf("PG004: %s uses %q, which is not pinned to a full commit SHA", [loc, ref])
}
