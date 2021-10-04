import { Context } from "@actions/github/lib/context";
import { GitHub } from "@actions/github/lib/utils";

type Api = InstanceType<typeof GitHub>;

/**
 * Populates `context.payload.pull_request` with the associated PR
 */
export default async function resolvePullRequest(context: Context, api: Api) {
  if (!isPullRequest(context)) return false;
  if (!context.payload.pull_request) {
    const workflowRun = context.payload.workflow_run;
    const isFork = workflowRun.head_repository.fork;

    context.payload.pull_request = await (isFork
      ? resolveForkPr
      : resolveRepoPr)({
      workflowRun,
      owner: context.repo.owner,
      repo: context.repo.repo,
      api,
    });
  }
  return true;
}

/** Whether this workflow has an associated pull request */
function isPullRequest(context: Context) {
  const isPullRequestEvent = !!context.payload.pull_request;
  const isWorkflowRunTriggeredByPullRequest =
    context.payload.workflow_run?.event === "pull_request";
  return isPullRequestEvent || isWorkflowRunTriggeredByPullRequest;
}

interface ResolveArgs {
  workflowRun: any;
  owner: string;
  repo: string;
  api: Api;
}

function resolveRepoPr({ workflowRun, owner, repo, api }: ResolveArgs) {
  const number = workflowRun.pull_requests?.[0]?.number;
  if (number) console.log("Resolved repo PR #" + number);
  else throw Error("Could not resolve repo PR from workflow_run.pull_requests");
  return api.pulls
    .get({
      pull_number: number,
      owner,
      repo,
    })
    .then(({ data }) => data);
}

function resolveForkPr({ workflowRun, owner, repo, api }: ResolveArgs) {
  const sender = workflowRun.head_repository.owner.login;
  const branch = workflowRun.head_branch;
  const head = `${sender}:${branch}`;

  return api.pulls
    .list({
      repo,
      owner,
      head,
    })
    .then(({ data: pulls }) => {
      if (pulls.length === 1)
        console.log("Resolved fork PR #" + pulls[0].number);
      else throw Error("Could not resolve fork PR from " + head);
      return pulls[0];
    });
}
