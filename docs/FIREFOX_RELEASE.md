# Firefox releases

In the GitHub repository, open **Settings → Secrets and variables → Actions** and create two repository secrets.

| Secret name | Value from Mozilla Add-ons |
| --- | --- |
| `AMO_JWT_ISSUER` | JWT issuer |
| `AMO_JWT_SECRET` | JWT secret |

A push of an annotated `vX.Y.Z` tag runs the package and test jobs first. The release workflow submits the Firefox build to Mozilla for unlisted signing and adds the returned `.xpi` and its SHA-256 checksum to the GitHub release. Firefox users can install the signed download from the gear menu in `about:addons` using **Install Add-on From File**. The Firefox ZIP remains available for temporary installs.

If both secrets are absent, the workflow publishes the temporary-install ZIP. If signing is configured and fails, the release waits for the signing issue to be resolved. If Mozilla already has the version and is still reviewing it, check that version in the Add-ons Developer Hub before retrying. Firefox users update by downloading the next signed XPI from GitHub Releases.

## Reproduce the Firefox package for Mozilla review

Extract the submitted source ZIP. From its root, use Node.js 22.2 or later and run:

```sh
npm ci
npm run package
```

The Firefox package is `release/T3CodeToolkit-extension-firefox-<version>.zip`. The build bundles `src/core/index.js` into `extension/core.js`. The packager prepares the Firefox manifest and adds the extension files to the ZIP.
