import { getOctokit } from "@actions/github";
import { exec } from "@actions/exec";
import axios from "axios";
import { createWriteStream } from "fs";
import { Readable } from "stream";
import { fileSync } from "tmp";
import { Context } from "@actions/github/lib/context";

type Api = ReturnType<typeof getOctokit>;

interface DownloadBundleArgs {
  api: Api;
  workflowRunId: number;
  artifactName: string;
  path: string;
  owner: string;
  repo: string;
}

export default async function downloadArtifact({
  api,
  workflowRunId,
  artifactName,
  path,
  owner,
  repo,
}: DownloadBundleArgs) {
  const url = await resolveArchiveDownloadUrl({
    api,
    workflowRunId,
    artifactName,
    owner,
    repo,
  });

  const archive = fileSync({ postfix: ".zip" });
  await downloadFile(url, archive.name);
  await extractArchive(archive.name, path);
}

interface ResolveArgs {
  api: Api;
  workflowRunId: number;
  artifactName: string;
  repo: string;
  owner: string;
}
export function resolveArchiveDownloadUrl({
  api,
  workflowRunId,
  artifactName,
  repo,
  owner,
}: ResolveArgs): Promise<string> {
  return api.actions
    .listWorkflowRunArtifacts({
      owner,
      repo,
      run_id: workflowRunId,
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
        request: { redirect: "manual" },
      })
    )
    .then((response) => {
      const url = response.headers.location;
      if (!url) throw Error("No download url specified");
      return url;
    });
}

export function downloadFile(url: string, destination: string): Promise<void> {
  const writer = createWriteStream(destination);

  return axios({
    method: "get",
    url: url,
    responseType: "stream",
  }).then((response) => {
    return new Promise<void>((resolve, reject) => {
      const stream = response.data as Readable;
      stream.pipe(writer);
      writer.on("error", (err) => {
        writer.close();
        reject(err);
      });
      writer.on("close", () => void resolve());
    });
  });
}

export async function extractArchive(
  archivePath: string,
  destinationFolder: string
): Promise<void> {
  const code = await exec("unzip", [
    "-qo",
    archivePath,
    "-d",
    destinationFolder,
  ]);
  if (code != 0) throw Error("unzip exited with code " + code);
}
