package terraform

# PG003: no wildcard IAM actions or resources in Allow statements.

iam_policy_types := {
	"aws_iam_policy",
	"aws_iam_role_policy",
	"aws_iam_user_policy",
	"aws_iam_group_policy",
}

# IAM allows a single statement object or a list, and a string or a list for Action and Resource.
statements(doc) := [doc.Statement] if is_object(doc.Statement)

statements(doc) := doc.Statement if is_array(doc.Statement)

as_list(x) := [x] if is_string(x)

as_list(x) := x if is_array(x)

wildcard_action(action) if action == "*"

wildcard_action(action) if endswith(action, ":*")

allow_statements contains [rc, st] if {
	some type in iam_policy_types
	some rc in managed(type)
	doc := json.unmarshal(rc.change.after.policy)
	some st in statements(doc)
	st.Effect == "Allow"
}

deny contains msg if {
	some [rc, st] in allow_statements
	some action in as_list(st.Action)
	wildcard_action(action)
	msg := sprintf("PG003: %s allows the wildcard action %q", [rc.address, action])
}

deny contains msg if {
	some [rc, st] in allow_statements
	"*" in as_list(st.Resource)
	msg := sprintf("PG003: %s allows the wildcard resource \"*\"", [rc.address])
}
