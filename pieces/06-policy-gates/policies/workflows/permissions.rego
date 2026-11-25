package workflows

# PG005: least-privilege workflow permissions.

# Without a permissions block the token gets the repository default, which can be read-write.
deny contains msg if {
	some job_id, job in input.jobs
	not input.permissions
	not job.permissions
	msg := sprintf(
		"PG005: jobs.%s has no permissions block and the workflow sets none (add permissions: contents: read)",
		[job_id],
	)
}

deny contains "PG005: the workflow sets permissions: write-all" if input.permissions == "write-all"

deny contains msg if {
	some job_id, job in input.jobs
	job.permissions == "write-all"
	msg := sprintf("PG005: jobs.%s sets permissions: write-all", [job_id])
}
