package workflows

# PG006: OIDC instead of static cloud credentials. Keys are compared in lower case.

static_credential_keys := {
	"aws_access_key_id",
	"aws_secret_access_key",
	"aws_session_token",
	"aws-access-key-id",
	"aws-secret-access-key",
	"aws-session-token",
	"google_credentials",
	"credentials_json",
	"azure_client_secret",
	"arm_client_secret",
}

deny contains msg if {
	walk(input, [path, _])
	count(path) > 0
	key := path[count(path) - 1]
	is_string(key)
	lower(key) in static_credential_keys
	msg := sprintf(
		"PG006: static cloud credential %q at %s (use OIDC with role-to-assume instead)",
		[key, concat(".", [sprintf("%v", [p]) | some p in path])],
	)
}
