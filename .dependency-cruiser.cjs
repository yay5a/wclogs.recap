module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'warn',
      comment: 'Circular dependencies increase coupling; warn first so existing cycles can be ratcheted.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-packages-to-apps',
      severity: 'error',
      comment: 'Packages must not depend on application layers.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'no-domain-or-shared-to-outer-layers',
      severity: 'error',
      comment: 'Domain and shared packages must remain transport and persistence agnostic.',
      from: { path: '^packages/(domain|shared)/src/' },
      to: { path: '^(apps/|packages/(db|discord|wcl-client)/src/)' },
    },
    {
      name: 'no-wcl-client-to-db',
      severity: 'error',
      comment: 'WCL client code must receive cache/store ports from composition layers.',
      from: { path: '^packages/wcl-client/src/' },
      to: { path: '^packages/db/src/' },
    },
    {
      name: 'no-web-to-worker',
      severity: 'error',
      comment: 'Apps should not import from other app layers.',
      from: { path: '^apps/web/' },
      to: { path: '^apps/worker/' },
    },
    {
      name: 'no-worker-to-web',
      severity: 'error',
      comment: 'Apps should not import from other app layers.',
      from: { path: '^apps/worker/' },
      to: { path: '^apps/web/' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules|dist',
    },
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
