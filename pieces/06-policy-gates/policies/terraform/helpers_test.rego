package terraform

# Test helpers shared by the rule tests in this package.

plan(changes) := {"format_version": "1.2", "resource_changes": changes}

res(type, name, after) := {
	"address": sprintf("%s.%s", [type, name]),
	"type": type,
	"name": name,
	"change": {"actions": ["create"], "after": after},
}

destroyed(type, name, before) := {
	"address": sprintf("%s.%s", [type, name]),
	"type": type,
	"name": name,
	"change": {"actions": ["delete"], "after": null, "before": before},
}

rule_ids(denials) := {id |
	some msg in denials
	id := split(msg, ":")[0]
}
