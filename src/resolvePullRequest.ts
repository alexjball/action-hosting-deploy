import { Context } from "@actions/github/lib/context";
import { GitHub } from "@actions/github/lib/utils";

type Api = InstanceType<typeof GitHub>;

/**
 * Populates `context.payload.pull_request` if not already set and the event
 * references a pull request.
 */
export async function resolvePullRequest(context: Context, api: Api) {
  const pullRequestNumber =
    context.payload.workflow_run?.pull_requests?.[0]?.number;
  if (
    context.eventName === "workflow_run" &&
    context.payload.workflow_run?.event === "pull_request" &&
    pullRequestNumber
  ) {
    const { repo, owner } = context.repo;
    context.payload.pull_request = await api.pulls
      .get({
        pull_number: pullRequestNumber,
        owner,
        repo,
      })
      .then(({ data }) => data);
  }
  return !!context.payload.pull_request;
}
