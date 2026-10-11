/*
 * A test-only OAuth validator for PostgreSQL 18: accepts bearer tokens of
 * the form "good.<role>" for that role and rejects everything else. Built
 * by the integration test harness; never use it outside tests.
 */
#include "postgres.h"

#include "fmgr.h"
#include "libpq/oauth.h"

PG_MODULE_MAGIC;

static bool
validate_token(const ValidatorModuleState *state, const char *token,
			   const char *role, ValidatorModuleResult *result)
{
	if (strncmp(token, "good.", 5) == 0 && strcmp(token + 5, role) == 0)
	{
		result->authorized = true;
		result->authn_id = pstrdup(role);
	}
	else
	{
		result->authorized = false;
		result->authn_id = NULL;
	}
	return true;
}

static const OAuthValidatorCallbacks callbacks = {
	PG_OAUTH_VALIDATOR_MAGIC,
	.validate_cb = validate_token,
};

const OAuthValidatorCallbacks *
_PG_oauth_validator_module_init(void)
{
	return &callbacks;
}
