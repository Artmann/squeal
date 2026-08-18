# Changelog

## [1.4.1](https://github.com/Artmann/squeal/compare/v1.4.0...v1.4.1) (2026-08-18)


### Bug Fixes

* **databases:** read the live connection without mutating a ref in render ([f29e762](https://github.com/Artmann/squeal/commit/f29e76247e71d0d30d80f922dd34fe696acb75e7))
* **databases:** retire a connection test result when its values change ([ab84d30](https://github.com/Artmann/squeal/commit/ab84d30baef67dd84701fb4fd7a1f5b06431cd8d)), closes [#66](https://github.com/Artmann/squeal/issues/66)
* **queries:** make cancel answerable for a query's whole life ([7e18d9d](https://github.com/Artmann/squeal/commit/7e18d9d1ef81498ab48f66d8b0ad74cc47b23ad1)), closes [#50](https://github.com/Artmann/squeal/issues/50)
* **results:** give each result column its own alignment and identity ([3862a45](https://github.com/Artmann/squeal/commit/3862a4510cd817ee4871e5c103e9166cfc9904c0))
* **sql-parser:** clamp token end to the end of the input ([1eeca40](https://github.com/Artmann/squeal/commit/1eeca40bdc704c6d9f983a2753f8a6b712f0341c)), closes [#64](https://github.com/Artmann/squeal/issues/64)
* **worksheets:** make WorksheetService the sole owner of sortOrder ([f923224](https://github.com/Artmann/squeal/commit/f923224dd0051ac6e8d262612a5e06e5ad52f024)), closes [#53](https://github.com/Artmann/squeal/issues/53)

## [1.4.0](https://github.com/Artmann/squeal/compare/v1.3.1...v1.4.0) (2026-08-17)


### Features

* **explorer:** refresh the database tree without restarting ([dc1536a](https://github.com/Artmann/squeal/commit/dc1536aa54b277ed14c987f74d5c4f2f0e2b21a6))
* **secret-storage:** ask before using the OS keychain ([fb25d98](https://github.com/Artmann/squeal/commit/fb25d98b086a568b68610d6ae336abdfe502bf7b))
* **worksheets:** run the query when you pick "Query Table" ([a9cc11f](https://github.com/Artmann/squeal/commit/a9cc11fbff0771603f6349c668e69049e9038a69))


### Bug Fixes

* **app:** load every collection at once and show an error when a load fails ([cf98cab](https://github.com/Artmann/squeal/commit/cf98cabe25e7b831b949855c1131aa445bd39079))
* **build:** label the macOS bundle "Squeal" instead of "squeal" ([7c6c961](https://github.com/Artmann/squeal/commit/7c6c961c758b80c83fdfa98064237db124439927))
* **database:** add columns missing from databases created by older versions ([4388fcd](https://github.com/Artmann/squeal/commit/4388fcd05bf64bf1d05b2c0a9ec233041d4e5a0e))
* **databases:** only lend a stored password to the server it was saved for ([0c95572](https://github.com/Artmann/squeal/commit/0c95572af13e85fa244fa407b2419de51d54e69a)), closes [#49](https://github.com/Artmann/squeal/issues/49)
* **databases:** roll back a created database when linking a worksheet fails ([c3c9c9e](https://github.com/Artmann/squeal/commit/c3c9c9ee29c0bf5f8ac3e73a55ca067394d33992))
* **editor:** stop reconfiguring CodeMirror on every keystroke ([d97bd21](https://github.com/Artmann/squeal/commit/d97bd21b089ca4228404ed41cdebb2a058c2a8f7))
* **explorer:** keep the refresh under the complexity and format gates ([f63e941](https://github.com/Artmann/squeal/commit/f63e941fe1e85f49de7a824512e71430dfdafb52))
* **explorer:** let a click collapse a row the search forced open ([d45bd5f](https://github.com/Artmann/squeal/commit/d45bd5f0265d82323ec24408120e857ba2cfde6a)), closes [#61](https://github.com/Artmann/squeal/issues/61)
* **postgres:** report a canceled query as canceled on any server locale ([4ceaf41](https://github.com/Artmann/squeal/commit/4ceaf41cc2c41d8458ec0c3096729c515366a5bf)), closes [#55](https://github.com/Artmann/squeal/issues/55)
* **tabs:** keep the last worksheet tab closed ([e2dea38](https://github.com/Artmann/squeal/commit/e2dea38bb32507ea78ebb8b9fe6ddcb9e3685913)), closes [#59](https://github.com/Artmann/squeal/issues/59)
* **ui:** keep the window controls reachable behind first-run screens ([8fcae7e](https://github.com/Artmann/squeal/commit/8fcae7e4cba8106d6ce1620a90cbaae63e2b8323)), closes [#60](https://github.com/Artmann/squeal/issues/60)
* **ui:** stop ResizeHandle from pinning user-select app-wide ([886cbb2](https://github.com/Artmann/squeal/commit/886cbb240d8a7c437d18577ed7f799240907596d)), closes [#68](https://github.com/Artmann/squeal/issues/68)


### Performance Improvements

* **database:** pair WAL with synchronous = NORMAL ([cbf2113](https://github.com/Artmann/squeal/commit/cbf2113cdc6c64610c4c513c10773d58963b4dd1))
* **http:** cache CORS preflights, and stop tracing them ([a9e5a6e](https://github.com/Artmann/squeal/commit/a9e5a6e6cad83a7628276c75358b1ed061f88a49))
* **tracing:** batch span writes with a linger window ([700be63](https://github.com/Artmann/squeal/commit/700be63a817a1f1a90d16109af31229add5e7fa5))

## [1.3.1](https://github.com/Artmann/squeal/compare/v1.3.0...v1.3.1) (2026-08-03)


### Bug Fixes

* **release:** fail early when notarization is not available ([#42](https://github.com/Artmann/squeal/issues/42)) ([11301d4](https://github.com/Artmann/squeal/commit/11301d431e768ae469ee755cc5c5c7cc88ffbe83))

## [1.3.0](https://github.com/Artmann/squeal/compare/v1.2.0...v1.3.0) (2026-08-03)


### Features

* Add MySQL demo database alongside PostgreSQL ([37ee34d](https://github.com/Artmann/squeal/commit/37ee34d2cb34390f1961b10b4d53b8fad6a397ba))
* **app:** derive the renderer API client from the shared contract ([fa78f4e](https://github.com/Artmann/squeal/commit/fa78f4e219bbfbafa9f63f0ce7b8588e7f731757))
* **databases:** report the server version for the status bar ([51ef14c](https://github.com/Artmann/squeal/commit/51ef14c4ec9de1153923afa397e5fcc98e4eedba))
* Default to first available database when running queries. ([d84516e](https://github.com/Artmann/squeal/commit/d84516e077108cbe79e064573b190a042ac96d2f))
* **editor:** retheme CodeMirror, add Format query and cursor reporting ([a179b60](https://github.com/Artmann/squeal/commit/a179b6026af853ebcf8d4f969caf3633e27db126))
* **glue:** shared HttpApi contract with schemas, tagged errors, security tags ([3ef2429](https://github.com/Artmann/squeal/commit/3ef2429938b840de477c16c0756662f369aa21f8))
* **main:** boot the backend on a ManagedRuntime and add shutdown ([861df68](https://github.com/Artmann/squeal/commit/861df682d0fbeeec8d9ece584e55001a69af1789))
* **server:** core Effect services with layer-based tests ([b9a4b0f](https://github.com/Artmann/squeal/commit/b9a4b0f1114e787674fc590360a964fb2e1cf0da))
* **server:** custom Effect Tracer writing into the spans table ([f6adf1d](https://github.com/Artmann/squeal/commit/f6adf1df26614439108fab44cb20c3f0c2fef4a1))
* **server:** HttpApi handlers, bearer auth, and the server layer ([901cce6](https://github.com/Artmann/squeal/commit/901cce62ea4a640ae75aaf18498d72930677a007))
* **server:** QueryRunner service with scoped fibers and boot effects ([b85056e](https://github.com/Artmann/squeal/commit/b85056e2b64232f822613e2db0039fcec443b7c3))
* **tabs:** rename, reorder, and jump between worksheet tabs ([7206ec1](https://github.com/Artmann/squeal/commit/7206ec15866c57e1496302bcdf83b93cc7e8543f))
* **ui:** add the squeal design tokens and a 40px title bar ([9860cc4](https://github.com/Artmann/squeal/commit/9860cc4e324e2e6cae65600ba8f2d39bb23fa775))
* **ui:** add the status bar and assemble the new shell ([77c5550](https://github.com/Artmann/squeal/commit/77c55506dc46f16e79441a95a0dbec04df81745b))
* **ui:** dock the results pane and virtualize the table ([0117a8c](https://github.com/Artmann/squeal/commit/0117a8c8e9c4617d35d0ef6db61fc0888f18da4c))
* **ui:** make the sidebar resizable and restyle the explorers ([e3089ee](https://github.com/Artmann/squeal/commit/e3089eee98559e95a2da49b199a338b0eef7295d))
* **ui:** open several worksheets at once in tabs ([85f7b51](https://github.com/Artmann/squeal/commit/85f7b5165a3c15ecebb8db20cada61f90f797e64))
* **ui:** replace the worksheet header with a toolbar and connection picker ([2dd6ea6](https://github.com/Artmann/squeal/commit/2dd6ea6fb158b09ac167501ecee169959c4d581b))
* **updates:** let Squeal update itself ([b5cb231](https://github.com/Artmann/squeal/commit/b5cb231c20f265cd641d2064ea683c598f09915b))
* **worksheets:** create new worksheets at the top of the list ([aa46f21](https://github.com/Artmann/squeal/commit/aa46f21abacb8abaf6465b5533ff864eba95a1ca))
* **worksheets:** delete a worksheet ([9c3a21a](https://github.com/Artmann/squeal/commit/9c3a21abdf5004597d797f6625afcbe735265c61))
* **worksheets:** reuse the current database for new worksheets ([d94a292](https://github.com/Artmann/squeal/commit/d94a292b47292f394a4c64be9ce7261e1cca0683))


### Bug Fixes

* **app:** make API client failures actionable again ([cc3aad7](https://github.com/Artmann/squeal/commit/cc3aad7d7d61b45d7ee784b3271646c503c9df47))
* **app:** number untitled worksheets past the highest suffix ([94d4458](https://github.com/Artmann/squeal/commit/94d4458dec777a98fbd82f230499da1fead2a7ae))
* **build:** bundle mysql2 and pg-cursor into packaged builds ([2931b60](https://github.com/Artmann/squeal/commit/2931b60c8f3ae374b11d1e1e5f4fe106ed43be81))
* **databases:** pair the database type with its connection info ([c73ae8e](https://github.com/Artmann/squeal/commit/c73ae8ef361d05d994637b8cfdd514bb3e49add5))
* **databases:** stop connection cleanup masking query errors ([7a41112](https://github.com/Artmann/squeal/commit/7a4111244fb96aa13ae27bd7e66e35c3d64c52ab))
* **main:** make shutdown durable and stop a second instance clobbering state ([cc4c41d](https://github.com/Artmann/squeal/commit/cc4c41d6b42ec6ba1fe9b95e3ecb730040b7ac08))
* Port is not required. ([a3a3c2a](https://github.com/Artmann/squeal/commit/a3a3c2a896160941239c53453ea515cb822eedef))
* **release:** sign and notarize the macOS app, ship a DMG ([2bfd23d](https://github.com/Artmann/squeal/commit/2bfd23d82d23fca8129c3350059cd8646068eb4e))
* **server:** enforce CORS, guard Host, and bound request bodies ([1727b4a](https://github.com/Artmann/squeal/commit/1727b4abb9d27ef9159a1c01a39703bfa8d6fdc9))
* **server:** flush spans on shutdown and validate inherited trace ids ([d866423](https://github.com/Artmann/squeal/commit/d8664232235cace705f94bb52f3656e4cd7df8e5))
* **server:** only lend a stored password back to the server it was saved for ([7fb12a2](https://github.com/Artmann/squeal/commit/7fb12a2b843a7f6953ae23d8ea80c10c80387494))
* **server:** read stored query results that predate the truncated field ([05284bb](https://github.com/Artmann/squeal/commit/05284bb82ddb52e9c33c7116f686d071445555ae))
* **server:** stop one bad row breaking the databases list, and tell the truth ([4e79957](https://github.com/Artmann/squeal/commit/4e799578e916c61f5398a8e27436e30fad13fabb))
* **ui:** address CI and review findings ([fd15e5a](https://github.com/Artmann/squeal/commit/fd15e5a953de79acd8734547ed6803ebdd93114c))
* **ui:** read the tab element map through its ref inside the effect ([e504d05](https://github.com/Artmann/squeal/commit/e504d05ecc6c36274232da6e507815ceb5aa9d36))
* Update the port placeholder. ([b779301](https://github.com/Artmann/squeal/commit/b779301163d383895bf552a67d1224299e50c4b2))
* **updates:** make installing idempotent and route the Linux check through Chromium ([53954df](https://github.com/Artmann/squeal/commit/53954df0eda9e8645f4783b6ae04dc6d6c2545c6))
* **worksheets:** keep the rename input focused from the context menu ([4ae26c8](https://github.com/Artmann/squeal/commit/4ae26c8aaf670dc67318edf58795251f62586716))
* **worksheets:** run the statement in the editor, not the saved copy ([ac2aee5](https://github.com/Artmann/squeal/commit/ac2aee51fc080a9cc2292f657e35ce14a2ae64eb))

## [1.2.0](https://github.com/Artmann/squeal/compare/squeal-v1.1.0...squeal-v1.2.0) (2026-08-03)


### Features

* **app:** derive the renderer API client from the shared contract ([fa78f4e](https://github.com/Artmann/squeal/commit/fa78f4e219bbfbafa9f63f0ce7b8588e7f731757))
* **databases:** report the server version for the status bar ([51ef14c](https://github.com/Artmann/squeal/commit/51ef14c4ec9de1153923afa397e5fcc98e4eedba))
* **editor:** retheme CodeMirror, add Format query and cursor reporting ([a179b60](https://github.com/Artmann/squeal/commit/a179b6026af853ebcf8d4f969caf3633e27db126))
* **glue:** shared HttpApi contract with schemas, tagged errors, security tags ([3ef2429](https://github.com/Artmann/squeal/commit/3ef2429938b840de477c16c0756662f369aa21f8))
* **main:** boot the backend on a ManagedRuntime and add shutdown ([861df68](https://github.com/Artmann/squeal/commit/861df682d0fbeeec8d9ece584e55001a69af1789))
* **server:** core Effect services with layer-based tests ([b9a4b0f](https://github.com/Artmann/squeal/commit/b9a4b0f1114e787674fc590360a964fb2e1cf0da))
* **server:** custom Effect Tracer writing into the spans table ([f6adf1d](https://github.com/Artmann/squeal/commit/f6adf1df26614439108fab44cb20c3f0c2fef4a1))
* **server:** HttpApi handlers, bearer auth, and the server layer ([901cce6](https://github.com/Artmann/squeal/commit/901cce62ea4a640ae75aaf18498d72930677a007))
* **server:** QueryRunner service with scoped fibers and boot effects ([b85056e](https://github.com/Artmann/squeal/commit/b85056e2b64232f822613e2db0039fcec443b7c3))
* **tabs:** rename, reorder, and jump between worksheet tabs ([7206ec1](https://github.com/Artmann/squeal/commit/7206ec15866c57e1496302bcdf83b93cc7e8543f))
* **ui:** add the squeal design tokens and a 40px title bar ([9860cc4](https://github.com/Artmann/squeal/commit/9860cc4e324e2e6cae65600ba8f2d39bb23fa775))
* **ui:** add the status bar and assemble the new shell ([77c5550](https://github.com/Artmann/squeal/commit/77c55506dc46f16e79441a95a0dbec04df81745b))
* **ui:** dock the results pane and virtualize the table ([0117a8c](https://github.com/Artmann/squeal/commit/0117a8c8e9c4617d35d0ef6db61fc0888f18da4c))
* **ui:** make the sidebar resizable and restyle the explorers ([e3089ee](https://github.com/Artmann/squeal/commit/e3089eee98559e95a2da49b199a338b0eef7295d))
* **ui:** open several worksheets at once in tabs ([85f7b51](https://github.com/Artmann/squeal/commit/85f7b5165a3c15ecebb8db20cada61f90f797e64))
* **ui:** replace the worksheet header with a toolbar and connection picker ([2dd6ea6](https://github.com/Artmann/squeal/commit/2dd6ea6fb158b09ac167501ecee169959c4d581b))
* **worksheets:** create new worksheets at the top of the list ([aa46f21](https://github.com/Artmann/squeal/commit/aa46f21abacb8abaf6465b5533ff864eba95a1ca))
* **worksheets:** delete a worksheet ([9c3a21a](https://github.com/Artmann/squeal/commit/9c3a21abdf5004597d797f6625afcbe735265c61))
* **worksheets:** reuse the current database for new worksheets ([d94a292](https://github.com/Artmann/squeal/commit/d94a292b47292f394a4c64be9ce7261e1cca0683))


### Bug Fixes

* **app:** make API client failures actionable again ([cc3aad7](https://github.com/Artmann/squeal/commit/cc3aad7d7d61b45d7ee784b3271646c503c9df47))
* **app:** number untitled worksheets past the highest suffix ([94d4458](https://github.com/Artmann/squeal/commit/94d4458dec777a98fbd82f230499da1fead2a7ae))
* **build:** bundle mysql2 and pg-cursor into packaged builds ([2931b60](https://github.com/Artmann/squeal/commit/2931b60c8f3ae374b11d1e1e5f4fe106ed43be81))
* **databases:** pair the database type with its connection info ([c73ae8e](https://github.com/Artmann/squeal/commit/c73ae8ef361d05d994637b8cfdd514bb3e49add5))
* **databases:** stop connection cleanup masking query errors ([7a41112](https://github.com/Artmann/squeal/commit/7a4111244fb96aa13ae27bd7e66e35c3d64c52ab))
* **main:** make shutdown durable and stop a second instance clobbering state ([cc4c41d](https://github.com/Artmann/squeal/commit/cc4c41d6b42ec6ba1fe9b95e3ecb730040b7ac08))
* **server:** enforce CORS, guard Host, and bound request bodies ([1727b4a](https://github.com/Artmann/squeal/commit/1727b4abb9d27ef9159a1c01a39703bfa8d6fdc9))
* **server:** flush spans on shutdown and validate inherited trace ids ([d866423](https://github.com/Artmann/squeal/commit/d8664232235cace705f94bb52f3656e4cd7df8e5))
* **server:** only lend a stored password back to the server it was saved for ([7fb12a2](https://github.com/Artmann/squeal/commit/7fb12a2b843a7f6953ae23d8ea80c10c80387494))
* **server:** read stored query results that predate the truncated field ([05284bb](https://github.com/Artmann/squeal/commit/05284bb82ddb52e9c33c7116f686d071445555ae))
* **server:** stop one bad row breaking the databases list, and tell the truth ([4e79957](https://github.com/Artmann/squeal/commit/4e799578e916c61f5398a8e27436e30fad13fabb))
* **ui:** address CI and review findings ([fd15e5a](https://github.com/Artmann/squeal/commit/fd15e5a953de79acd8734547ed6803ebdd93114c))
* **ui:** read the tab element map through its ref inside the effect ([e504d05](https://github.com/Artmann/squeal/commit/e504d05ecc6c36274232da6e507815ceb5aa9d36))
* **worksheets:** keep the rename input focused from the context menu ([4ae26c8](https://github.com/Artmann/squeal/commit/4ae26c8aaf670dc67318edf58795251f62586716))
* **worksheets:** run the statement in the editor, not the saved copy ([ac2aee5](https://github.com/Artmann/squeal/commit/ac2aee51fc080a9cc2292f657e35ce14a2ae64eb))

## [1.1.0](https://github.com/Artmann/squeal/compare/squeal-v1.0.0...squeal-v1.1.0) (2026-07-28)


### Features

* Add MySQL demo database alongside PostgreSQL ([37ee34d](https://github.com/Artmann/squeal/commit/37ee34d2cb34390f1961b10b4d53b8fad6a397ba))
* Default to first available database when running queries. ([d84516e](https://github.com/Artmann/squeal/commit/d84516e077108cbe79e064573b190a042ac96d2f))


### Bug Fixes

* Port is not required. ([a3a3c2a](https://github.com/Artmann/squeal/commit/a3a3c2a896160941239c53453ea515cb822eedef))
* Update the port placeholder. ([b779301](https://github.com/Artmann/squeal/commit/b779301163d383895bf552a67d1224299e50c4b2))
