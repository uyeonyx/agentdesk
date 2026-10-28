// Public half of the release signing key. The release workflow signs SHA256SUMS with the private
// half (GitHub secret UPDATE_SIGNING_KEY); the app accepts an update only with this signature.
// Rotating the key: see docs/release.md.
export const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAU8qW2hEtkyUwOjqcAPEHGWhNVKOi43Y/naOLOvglmZk=
-----END PUBLIC KEY-----
`;
