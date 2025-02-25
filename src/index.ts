/**
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  endGroup,
  getInput,
  setFailed,
  setOutput,
  startGroup,
} from "@actions/core";
import { context, getOctokit } from "@actions/github";
import { existsSync, rmdirSync } from "fs";
import { createCheck } from "./createCheck";
import { createGacFile } from "./createGACFile";
import {
  deployPreview,
  deployProductionSite,
  ErrorResult,
  interpretChannelDeployResult,
} from "./deploy";
import { getChannelId } from "./getChannelId";
import {
  getURLsMarkdownFromChannelDeployResult,
  postChannelSuccessComment,
} from "./postOrUpdateComment";
import resolvePullRequest from "./resolvePullRequest";
import { resolve } from "path";
import downloadArtifact from "./downloadArtifact";

// Inputs defined in action.yml
const expires = getInput("expires");
const projectId = getInput("projectId");
const googleApplicationCredentials = getInput("firebaseServiceAccount", {
  required: true,
});
const configuredChannelId = getInput("channelId");
const isProductionDeploy = configuredChannelId === "live";
const token = process.env.GITHUB_TOKEN || getInput("repoToken");
const octokit = token ? getOctokit(token) : undefined;
const entryPoint = getInput("entryPoint");
const target = getInput("target");
const artifactName = getInput("artifactName");
const workflowRunId = getInput("workflowRunId");

async function run() {
  let finish = (details: Object) => console.log(details);
  try {
    const isPullRequest = await resolvePullRequest(context, octokit);

    if (token && isPullRequest) {
      finish = await createCheck(octokit, context);
    }

    startGroup("Verifying firebase.json exists");

    if (entryPoint !== ".") {
      console.log(`Changing to directory: ${entryPoint}`);
      try {
        process.chdir(entryPoint);
      } catch (err) {
        throw Error(`Error changing to directory ${entryPoint}: ${err}`);
      }
    }

    if (existsSync("./firebase.json")) {
      console.log("firebase.json file found. Continuing deploy.");
    } else {
      throw Error(
        "firebase.json file not found. If your firebase.json file is not in the root of your repo, edit the entryPoint option of this GitHub action."
      );
    }
    endGroup();

    startGroup("Setting up CLI credentials");
    const gacFilename = await createGacFile(googleApplicationCredentials);
    console.log(
      "Created a temporary file with Application Default Credentials."
    );
    endGroup();

    if (artifactName) {
      startGroup("Downloading deployment files from artifact");

      const bundleDestination = require(resolve("./firebase.json"))?.hosting
        ?.public;

      if (!bundleDestination)
        throw Error("No hosting.public key specified in firebase.json");

      rmdirSync(bundleDestination, { recursive: true });

      const runId = workflowRunId
        ? parseInt(workflowRunId)
        : context.payload.workflow_run?.id ?? context.runId;

      await downloadArtifact({
        api: octokit,
        artifactName,
        path: bundleDestination,
        workflowRunId: runId,
        owner: context.repo.owner,
        repo: context.repo.repo,
      });

      endGroup();
    }

    if (isProductionDeploy) {
      startGroup("Deploying to production site");
      const deployment = await deployProductionSite(gacFilename, {
        projectId,
        target,
      });
      if (deployment.status === "error") {
        throw Error((deployment as ErrorResult).error);
      }
      endGroup();

      const hostname = target ? `${target}.web.app` : `${projectId}.web.app`;
      const url = `https://${hostname}/`;
      await finish({
        details_url: url,
        conclusion: "success",
        output: {
          title: `Production deploy succeeded`,
          summary: `[${hostname}](${url})`,
        },
      });
      return;
    }

    const channelId = getChannelId(configuredChannelId, context);

    startGroup(`Deploying to Firebase preview channel ${channelId}`);
    const deployment = await deployPreview(gacFilename, {
      projectId,
      expires,
      channelId,
      target,
    });

    if (deployment.status === "error") {
      throw Error((deployment as ErrorResult).error);
    }
    endGroup();

    const { expireTime, urls } = interpretChannelDeployResult(deployment);

    setOutput("urls", urls);
    setOutput("expire_time", expireTime);
    setOutput("details_url", urls[0]);

    const urlsListMarkdown =
      urls.length === 1
        ? `[${urls[0]}](${urls[0]})`
        : urls.map((url) => `- [${url}](${url})`).join("\n");

    if (token && isPullRequest && !!octokit) {
      const commitId = `${
        context.payload.pull_request?.head?.repo?.full_name
      }@${context.payload.pull_request?.head.sha.substring(0, 7)}`;

      await postChannelSuccessComment(octokit, context, deployment, commitId);
    }

    await finish({
      details_url: urls[0],
      conclusion: "success",
      output: {
        title: `Deploy preview succeeded`,
        summary: getURLsMarkdownFromChannelDeployResult(deployment),
      },
    });
  } catch (e) {
    setFailed(e.message);

    await finish({
      conclusion: "failure",
      output: {
        title: "Deploy preview failed",
        summary: `Error: ${e.message}`,
      },
    });
  }
}

run();
