# shellcheck shell=sh
# =============================================================================
# Ensure a PocketBase superuser exists before the server starts.
#
# Sourced - not executed - by docker/start.sh (monolith) and
# docker/pocketbase-entrypoint.sh (split PocketBase image), so the caller's
# `set -e` applies here. Without this, a fresh volume with no admin environment
# leaves PocketBase printing its first-run installer link, whose URL points at
# 0.0.0.0:8090 - an address no browser behind this container can reach.
#
# Callers set these before sourcing:
#   PB_BIN             path to the pocketbase binary
#   PB_DATA_DIR        --dir
#   PB_HOOKS_DIR       --hooksDir
#   PB_MIGRATIONS_DIR  --migrationsDir
#   PB_APP_USER        owner:group PocketBase runs as (only used when root)
#   PB_LOG_SERVICE     label prefixed to every line this script logs
#
# A caller may also define `log LEVEL message...` beforehand; the fallback below
# is used when it does not.
#
# Everything here is idempotent: it runs on every start, not just the first.
# =============================================================================

# Fallback logger. This repo has no logging framework in its entrypoints - they
# gate plain `echo` on LOG_LEVEL - so match that gating: warnings and errors are
# always visible (default LOG_LEVEL is `warn`), informational lines only at the
# verbose settings.
# `command -V`, not `command -v`: the contract is "the caller defined a shell
# function called log", and -v would also match an unrelated executable named
# `log` that happens to be on PATH - macOS ships one, which silently swallowed
# every line this script logged.
if ! command -V log 2>/dev/null | grep -q 'function'; then
    log() {
        _lvl="$1"
        shift
        case "$_lvl" in
            FATAL|ERROR|WARN)
                echo "[${PB_LOG_SERVICE}] ${_lvl}: $*" >&2
                ;;
            *)
                if [ "${LOG_LEVEL}" = "debug" ] || [ "${LOG_LEVEL}" = "verbose" ]; then
                    echo "[${PB_LOG_SERVICE}] ${_lvl}: $*"
                fi
                ;;
        esac
    }
fi

# Exits the container. Reserved for configuration that cannot be guessed at: a
# half-set credential pair is a typo, and booting past it would leave PocketBase
# waiting on its first-run installer link forever.
fatal() {
    log FATAL "$@"
    exit 1
}

# Replays a captured file through `log`, so third-party output (the PocketBase
# CLI) is formatted and level-gated like everything else this script emits.
log_stream() {
    [ -s "$2" ] || return 0
    while IFS= read -r _line; do
        log "$1" "$_line"
    done <"$2"
}

# 32 alphanumeric characters. Alphanumeric on purpose: the value gets pasted
# into shells, .env files and URLs by whoever reads it back out of
# $SUPERUSER_ENV, and a quoting mistake in a generated password is a silent
# lockout. 32 alphanumerics is ~190 bits.
random_secret() {
    head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-32
}

# Reads one KEY='value' pair out of $SUPERUSER_ENV. Parsed, never sourced: in
# the monolith this runs as root and $SUPERUSER_ENV lives on an operator-supplied
# volume, so `.` would be arbitrary code execution as root.
read_env_value() {
    sed -n "s/^$1='\{0,1\}\(.*[^']\)'\{0,1\}\$/\1/p" "$SUPERUSER_ENV" | head -n 1
}

# $SUPERUSER_ENV sits inside $PB_DATA_DIR, which the caller's directory setup
# and the post-upsert fix-up below both chown/chmod recursively. Re-assert
# root-only access after each.
protect_superuser_env() {
    [ -f "$SUPERUSER_ENV" ] || return 0
    if [ "$(id -u)" = 0 ]; then
        chown 0:0 "$SUPERUSER_ENV" 2>/dev/null || true
    fi
    chmod 600 "$SUPERUSER_ENV" 2>/dev/null || true
}

# The credentials file lives inside the data directory on purpose: it only
# describes that database, so a deployment that mounts pb_data rather than its
# parent keeps the two together instead of silently rotating the admin password
# on the next start.
SUPERUSER_ENV="${PB_DATA_DIR}/.pb_superuser.env"

# The placeholders shipped in .env.example, docker/README.md and the README's
# `docker run` example. Honouring them would create a superuser whose password
# is published in this repository, so they count as "not supplied". Both are
# cleared together: clearing only the password would send a deployment that
# passed the documented pair into the fatal branch below and stop it booting.
if [ "${POCKETBASE_ADMIN_PASSWORD:-}" = "your-secure-password" ]; then
    log WARN "Ignoring the placeholder POCKETBASE_ADMIN_EMAIL/PASSWORD pair from the documentation - a credential will be generated instead. Set both to real values to manage the account yourself."
    POCKETBASE_ADMIN_EMAIL=""
    POCKETBASE_ADMIN_PASSWORD=""
fi

PB_SU_GENERATED=0

if [ -n "${POCKETBASE_ADMIN_EMAIL:-}" ] && [ -n "${POCKETBASE_ADMIN_PASSWORD:-}" ]; then
    PB_SU_EMAIL="$POCKETBASE_ADMIN_EMAIL"
    PB_SU_PASS="$POCKETBASE_ADMIN_PASSWORD"
    log DEBUG "Using the superuser credentials supplied in the environment"
elif [ -n "${POCKETBASE_ADMIN_EMAIL:-}" ] || [ -n "${POCKETBASE_ADMIN_PASSWORD:-}" ]; then
    # Exactly one set is a typo, not an intention. Guessing the other half would
    # either invent a credential or silently ignore the one that was given.
    fatal "POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD must be set together. Set both, or leave both unset and a superuser is generated on first start."
elif [ -f "$SUPERUSER_ENV" ]; then
    # Reuse what an earlier start generated, so restarts do not rotate the
    # password out from under an operator who wrote it down.
    PB_SU_EMAIL="$(read_env_value POCKETBASE_ADMIN_EMAIL)"
    PB_SU_PASS="$(read_env_value POCKETBASE_ADMIN_PASSWORD)"
    if [ -z "$PB_SU_EMAIL" ] || [ -z "$PB_SU_PASS" ]; then
        fatal "${SUPERUSER_ENV} does not contain both POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD. Delete it to regenerate, or set both as container environment variables."
    fi
    log DEBUG "Reusing the generated superuser credentials in ${SUPERUSER_ENV}"
else
    # NOT admin@localhost: PocketBase's email validator rejects a single-label
    # domain, and `superuser upsert` reports that failure while still exiting 0.
    PB_SU_EMAIL="admin@video-ware.local"
    PB_SU_PASS="$(random_secret)"
    PB_SU_GENERATED=1
    # A subshell, so umask 077 covers the redirection that creates the file and
    # is restored by the subshell exiting - the password must never exist on
    # disk in a readable file, not even between two statements.
    (
        umask 077
        cat >"$SUPERUSER_ENV" <<EOF
# Generated on first start because neither POCKETBASE_ADMIN_EMAIL nor
# POCKETBASE_ADMIN_PASSWORD was supplied. Delete this file to have a new
# credential pair generated, or set both as container environment variables to
# manage the account yourself - this file is then ignored.
POCKETBASE_ADMIN_EMAIL='${PB_SU_EMAIL}'
POCKETBASE_ADMIN_PASSWORD='${PB_SU_PASS}'
EOF
    ) || fatal "Could not write ${SUPERUSER_ENV}"
fi

# The caller chmod -R'd everything under $PB_DATA_DIR on the way here, including
# this file on a restart. Nothing is supervised yet, so the window is closed
# before any other process runs.
protect_superuser_env

log INFO "Ensuring PocketBase superuser ${PB_SU_EMAIL} exists"

# Captured rather than streamed: the output has to be inspected below, and
# log_stream replays it afterwards at the level the outcome deserves.
#
# --hooksDir is required, unintuitively: migrations that `require` a module
# resolve it against the hooks directory, and a migration that fails there
# defers the whole app schema to `serve`, whose collections snapshot can then
# wipe the superuser this command just created. --hooksPool=1 keeps that from
# prewarming fifteen goja runtimes for a process that lives under a second.
PB_SU_LOG="$(mktemp)"
PB_SU_STATUS=0
# `|| PB_SU_STATUS=$?` rather than a bare call: under `set -e` a standalone
# command exiting non-zero would kill the container before the ownership fix-up
# and the diagnostics below could run.
"$PB_BIN" superuser upsert "$PB_SU_EMAIL" "$PB_SU_PASS" \
    --dir="$PB_DATA_DIR" \
    --hooksDir="$PB_HOOKS_DIR" \
    --migrationsDir="$PB_MIGRATIONS_DIR" \
    --hooksPool=1 \
    >"$PB_SU_LOG" 2>&1 || PB_SU_STATUS=$?

# In the monolith the upsert runs as root - on a fresh volume it is what creates
# data.db and, because --migrationsDir is passed, applies every app migration.
# PocketBase itself runs as $PB_APP_USER and would otherwise find its own
# database read-only and die on its first write. Unconditional: a failed upsert
# can still have created files.
if [ "$(id -u)" = 0 ]; then
    chown -R "$PB_APP_USER" "$PB_DATA_DIR" 2>/dev/null ||
        log WARN "Could not reset ownership of ${PB_DATA_DIR} to ${PB_APP_USER} - PocketBase does not run as root and will fail on its first write"
fi
protect_superuser_env

# Do NOT trust the exit status alone: `superuser upsert` exits 0 even when
# PocketBase's validator turns the account down, so a silent failure has to
# surface here rather than as an installer link nobody can use.
if [ "$PB_SU_STATUS" -eq 0 ] && grep -q 'Successfully saved superuser' "$PB_SU_LOG"; then
    log_stream DEBUG "$PB_SU_LOG"
    if [ "$PB_SU_GENERATED" -eq 1 ]; then
        # WARN, not INFO: the default LOG_LEVEL here is `warn`, and an operator
        # who never sees these two lines has no way to learn the credential
        # exists at all.
        log WARN "Generated a PocketBase superuser: ${PB_SU_EMAIL}"
        log WARN "Its password is in ${SUPERUSER_ENV} (mode 0600) - read it with: docker exec <container> cat ${SUPERUSER_ENV}"
    else
        log INFO "PocketBase superuser ${PB_SU_EMAIL} is ready"
    fi
else
    log ERROR "Could not create the PocketBase superuser ${PB_SU_EMAIL} (exit ${PB_SU_STATUS}) - PocketBase will fall back to printing a first-run installer link"
    log_stream ERROR "$PB_SU_LOG"
fi

rm -f "$PB_SU_LOG"

# Exported for supervisord, which expands %(ENV_POCKETBASE_ADMIN_EMAIL)s and
# %(ENV_POCKETBASE_ADMIN_PASSWORD)s into the worker's environment and refuses to
# start on an unset reference, and for the worker itself, which authenticates
# against the _superusers collection with exactly this pair.
POCKETBASE_ADMIN_EMAIL="$PB_SU_EMAIL"
POCKETBASE_ADMIN_PASSWORD="$PB_SU_PASS"
export POCKETBASE_ADMIN_EMAIL POCKETBASE_ADMIN_PASSWORD
