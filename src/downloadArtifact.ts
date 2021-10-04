import { Context } from "@actions/github/lib/context";
import { GitHub } from "@actions/github/lib/utils";
import { dirSync } from "tmp";
import * as https from "https";
import * as unzipper from "unzipper";

type Api = InstanceType<typeof GitHub>;

/**
 * Populates `context.payload.pull_request` for events triggered by the pull request.
 */
export async function downloadArtifact(
  context: Context,
  api: Api,
  artifactName: string
) {
  const pullRequestNumber = context.payload.pull_requests?.[0]?.number;
  if (
    context.eventName !== "workflow_run" ||
    context.payload.event !== "pull_request" ||
    !pullRequestNumber
  ) {
    throw Error("Unexpected event for pull request-triggered workflow run");
  }

  const { repo, owner } = context.repo;
  context.payload.pull_request = await api.pulls
    .get({
      pull_number: pullRequestNumber,
      owner,
      repo,
    })
    .then(({ data }) => data);

  return api.actions
    .listWorkflowRunArtifacts({
      owner,
      repo,
      run_id: context.payload.workflow_run.id,
    })
    .then(({ data: { artifacts } }) => {
      const artifact = artifacts.find((a) => a.name === artifactName);
      if (!artifact) {
        throw Error(`No artifact "${artifactName}" found`);
      }
      return artifact.id;
    })
    .then((artifact_id) =>
      api.actions.downloadArtifact({
        archive_format: "zip",
        artifact_id,
        repo,
        owner,
      })
    )
    .then((r) => downloadAndExtractArchive(r.headers.location));
}

function downloadAndExtractArchive(url) {
  return new Promise<string>((resolve) => {
    const tmpDir = dirSync();
    const path = tmpDir.name;
    const extractor = unzipper.Extract({ path });
    https.get(url, (r) => r.pipe(extractor));
    extractor.once("close", () => resolve(path));
  });
}
