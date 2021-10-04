import { Context } from "@actions/github/lib/context";
import { GitHub } from "@actions/github/lib/utils";

type Api = InstanceType<typeof GitHub>;

/**
 * Populates `context.payload.pull_request` for events triggered by the pull request.
 */
export async function resolvePullRequest(context: Context, api: Api) {
  const pullRequestNumber = context.payload.pull_requests?.[0]?.number;
  if (
    !context.payload.pull_request &&
    context.eventName === "workflow_run" &&
    context.payload.event === "pull_request" &&
    pullRequestNumber
  ) {
    context.payload.pull_request = await api.pulls
      .get({
        pull_number: pullRequestNumber,
        owner: context.repo.owner,
        repo: context.repo.repo,
      })
      .then(({ data }) => data);
  }
}
