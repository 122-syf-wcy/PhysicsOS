# PhysicsOS UI 素材审计（2026-11-14）

现有素材足以支撑本轮 UI 改造，建议新增生图为 **0 张**。本次只读素材与源码，未修改应用。玻璃材质用 CSS，实验和图表仍由真实引擎及数据绘制。

## 汇总

| 分类 | 数量 | 字节 |
| --- | ---: | ---: |
| brand | 3 | 28,823 |
| developer-docs | 9 | 213,978 |
| experiment-cover | 78 | 1,294,482 |
| product-mascot | 9 | 969,648 |
| custom-navigation-mask | 3 | 8,140 |
| website-brand | 1 | 18,901 |
| website-hero | 1 | 39,946 |
| vector-icon-components | 1 | 27,693 |

共 105 个资产文件，2,601,611 字节；线性图标组件导出 71 个 Icon。

## 分配与边界

- 品牌：应用壳、登录、favicon 延用 32/64/128px 标志。官网和文档保持既有稳定 URL。
- 官网：玻璃吉祥物复用首屏和 CTA；800px 原图足以支撑设计。现图为 RGB 白背景，不当作透明切图使用。
- 实验：78 张封面通过 ExperimentArt 现有映射复用；缺图仍走 SVG fallback，不代替科学场景。
- 小图标：沿用 physics-icons.tsx 的 24px SVG/currentColor/光学线宽；按钮外层提供可访问名称。
- 项目、画布、画板：3 张既有 PNG mask 保留原语义。
- 产品欢迎、思考、搜索空态：复用现有多分辨率 mascot；文档复用 developer/studio 专用素材。
- 相同哈希不意味着可以删除：既有 URL 与生成器引用需要保留。
- 许可仅保持仓库现有声明，本审计不改写授权。

## 逐项记录

精确来源路径、尺寸、字节数、SHA-256、源码引用与分配见配套 JSON。

| 路径 | 尺寸 | 字节 | SHA-256 | 引用数 |
| --- | --- | ---: | --- | ---: |
| `overlays/harness/files/apps/web/public/physicsos/brand/physicsos-mark-128.png` | 128×128 | 18901 | `ed17753fa0b9f7a6d00d2d3259502408302179ab061892e56f2c325104b54d2f` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/brand/physicsos-mark-32.png` | 32×32 | 2615 | `bc2fe57fbbdbfd383772cb7226c7c20c98a3ef2b05fa91a531682eb0d90cd7d4` | 0 |
| `overlays/harness/files/apps/web/public/physicsos/brand/physicsos-mark-64.png` | 64×64 | 7307 | `d07a0929219adc51a6914832c0221ff4921810e4aeb5af7962690015e646c3de` | 0 |
| `overlays/harness/files/apps/web/public/physicsos/developers/assets/mascot-developer-320.webp` | 320×320 | 22154 | `b63096f1cc389a58c11cc1694eac5bd40ff086d0d2bc62a8c409a375641f07c7` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/developers/assets/mascot-developer-640.webp` | 640×640 | 70736 | `308b1b79fd3265d7b966cb25ed2348d4ad11b1a3b75a061677e0e9783eeefeaf` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/developers/assets/physicsos-mark-128.png` | 128×128 | 18901 | `ed17753fa0b9f7a6d00d2d3259502408302179ab061892e56f2c325104b54d2f` | 2 |
| `overlays/harness/files/apps/web/public/physicsos/developers/assets/physicsos-mark-32.png` | 32×32 | 2615 | `bc2fe57fbbdbfd383772cb7226c7c20c98a3ef2b05fa91a531682eb0d90cd7d4` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/developers/assets/studio/icon-prompt.webp` | 192×192 | 7796 | `d9deff2992e7806932a17c1fa4dc019d03dc50f15b6d57ac306571ad4c884f7e` | 2 |
| `overlays/harness/files/apps/web/public/physicsos/developers/assets/studio/icon-review.webp` | 192×192 | 9904 | `a02307ddc5ab091c01bb5692b9bd76962865c1df78505a3a32d11c0da51a48e0` | 2 |
| `overlays/harness/files/apps/web/public/physicsos/developers/assets/studio/icon-upload.webp` | 192×192 | 9542 | `b08e9549c65bc9cc7b8130fd5a3afb1456eda33dab961b6dae7189449bbb7c7e` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/developers/assets/studio/mascot-studio-240.webp` | 240×240 | 18962 | `c32029635b083c228cf9d255c6e5ae07bbc730b83b35b4eea3d24bd3740d26cf` | 0 |
| `overlays/harness/files/apps/web/public/physicsos/developers/assets/studio/mascot-studio-480.webp` | 480×480 | 53368 | `10f4a3a00703661efccd6396420f203403a135cf132e793783fab826a76dc618` | 2 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/apparent-weight.jpg` | 512×512 | 24730 | `68da596fed4e05a00a7a28a19e8d1f955b31e7208417d159744fb8506b9daf43` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/atmospheric-pressure.jpg` | 512×512 | 24757 | `b0d29f7e2fb304cc6485b09e2d1e33214ac0dfdebfe8f8a3bc48e8ed859c705f` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/average-speed.jpg` | 512×512 | 16158 | `5cad287573ea83dc2269c6627a30f25a619fbb0dc166a1c8fb5870ef8e13b505` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/boiling-water.jpg` | 512×512 | 23956 | `b18680b46767757e79a0fbb759ce41e2cb48aac3f496d21fa1a5050e8495475f` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/bulb-power.jpg` | 512×512 | 12259 | `8dcac9d49ec1989ee15ce289a0f371e147124dcabe83ab32deed56f850dba4d5` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/buoyancy.jpg` | 512×512 | 24333 | `7448dcf0fdbe661558a2314d2b5b8e719793d6d2c6ba288bf2cf78cebb92d10e` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/chase-meeting.jpg` | 512×512 | 19585 | `416b8a03edbd5356fda42488690458c6883dc0c1dc1a07cc5ba945851c71376d` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/circular-orbit.jpg` | 512×512 | 19020 | `19aee7f65ad7153c1a9ff4034ecd16ca6b15f055eb5b8b8ac0600124c689eb7a` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/collision-elastic.jpg` | 512×512 | 11177 | `9912ba930dcd3262ed8e1566c225759096cf83b839ad346ebb8965e6c9fd08a6` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/collision-inelastic.jpg` | 512×512 | 12381 | `6a8a03bf81d841726bd18bf47c566a85b7f670ea5d7f71d07c83375d4e5c8795` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/collision-perfectly-inelastic.jpg` | 512×512 | 11412 | `92ae403ca814acfca9151c20c0992bc7ca8e3f42756db8dd58cf10a2d09762ec` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/composite-eb.jpg` | 512×512 | 14826 | `da9d9588df4640f9dd7bc34b2fe87e97f73bdcdec948e52cac7fb64fe0019e02` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/composite-ebg.jpg` | 512×512 | 12825 | `2821f87cc7f021d3b6f3e61ce3a55f389683bafe0580c395a02db5cbfc0901cc` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/concave-mirror.jpg` | 512×512 | 10363 | `b35f6e9a169dd504a297ab81be74461bacbcb0fac4d665edff4704fc7c8b5b55` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/concurrent-equilibrium.jpg` | 512×512 | 21917 | `fab7811c75415c073b8601ebdfa4b5a8de5eb42214ffc715baabca7669918a2f` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/convex-lens.jpg` | 512×512 | 9859 | `c0406f16ad39d80109904602aa30fae1937c4b4e34c86c32f79e76d36157982c` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/convex-mirror.jpg` | 512×512 | 15564 | `aaa16ff9ac03644225b99749772ead98c625c32a3ea2401e2ec68056dae6c4c2` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/crystal-melting.jpg` | 512×512 | 15910 | `aa05a37fbe3a41d04b32d69efdb9c7664d610d79ba87ac31b18fbc7cfd2985ac` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/cyclotron.jpg` | 512×512 | 21335 | `ad2106f89f5127454357d4d957e97e5c4f0134a347717ab934b848c8381a6400` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/echo-ranging.jpg` | 512×512 | 16580 | `16995d854d6858e3d1133ced82277fa87adf7e9e3ec5156f5bb4e2b8f2f383af` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/electromagnet.jpg` | 512×512 | 22937 | `524f9263116497fd5067271868686ff32deab4f5d324038bd2e1b0c019bb50cc` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/emf-measurement.jpg` | 512×512 | 15696 | `fc69727d7bcf109817d6ebe527c29dba0fa66e1a8891e2be3f3e0064c39a9793` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/force-composition.jpg` | 512×512 | 18622 | `3a472bf8a89a9ec613cb6b14764c446d6241d80053bc641c972dd90b127ab8f1` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/friction-mu.jpg` | 512×512 | 23256 | `930b51ba6205b1cb45434a6fb7197ffdf471b04a8c3e848d8794c0faf7882e98` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/friction-static.jpg` | 512×512 | 20946 | `deef91a719ac38a5a35b7da916a12b58658d2c89dedcca7807a2fac4fa670d37` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/heat-capacity-comparison.jpg` | 512×512 | 14825 | `d48367a2d61b568da6ae3fc256679878725c32a28db90fccce3ca1735133b2c4` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/hooke-law.jpg` | 512×512 | 21058 | `b86ae888fe5f115a7ef5adb3b65d42ecdc60fddaf3e3b7b85caedb6f81516af7` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/incline.jpg` | 512×512 | 19125 | `27085d5bf0cdee834ab29c36f4bc4ceed3f42164dfde5c0dd91d11267907a9eb` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/induction-bar-motion.jpg` | 512×512 | 13967 | `c1db3da26c7d638ea2f410205778c399b607115eec842c529945de33d8e20062` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/induction-double-bar-force.jpg` | 512×512 | 11062 | `66e281bb8a958cc49493a24c6895ac1a3214220c2e6de59f4d57bef7a656d71a` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/induction-double-bar-momentum.jpg` | 512×512 | 12067 | `9669d3496405b1d62f22b0ea99521a6d1e8aef71f3b46e47072be7e3f452d783` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/induction-flux-change.jpg` | 512×512 | 17689 | `9aa9f99516e2ad3765244d8955004e1ba2bc7341bbb010745d90ffae392193a5` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/lab.jpg` | 512×512 | 20882 | `5bf2b191a28e85d0e8371d1221d5a3039816c2118b2e5808e48dbca56a136a34` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/lever-balance.jpg` | 512×512 | 10816 | `5eb8d6f081808924d91306be7e1173be93ae641a34722962827293f0ac4d0548` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/liquid-pressure.jpg` | 512×512 | 21317 | `f0e0543c9514bbc9b4752593a38e450646024bb33f5faba2dcc34dbb2dc8cfde` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/magnetic-circular.jpg` | 512×512 | 10283 | `d4e702cf1b26998f86ae502f485aeaf9d80f13510803245c075253f974dd11e5` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/mass-spectrometer.jpg` | 512×512 | 14368 | `1703f61797434b1be7cae55d52f97f550297f150ec2e15be1d9d9f3b393db09a` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/mechanical-energy.jpg` | 512×512 | 18132 | `b0dbc42c7009392230dae8f0f021110431791e540c7eca90d6ae1e1f4bf31e03` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/mixed-circuit.jpg` | 512×512 | 11391 | `372491bd26a84ebdab9a199184eb2a23a9b530c8f8bdc48fe1fe4e975ffd199e` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/motor.jpg` | 512×512 | 20764 | `679249ca5b0636bc79d1d91f38dca9f4bd51c2b4bbda49c2f87c869070482d11` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/multi-point-charge.jpg` | 512×512 | 12083 | `48eb7da60b15a49f35cfef756da9737f518785d2091f89dd43601656ff09e392` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/multi-region-field.jpg` | 512×512 | 11700 | `eb4323fe9bb37f76e6d71579f11029d2f53c6f709988731da443c9ee3b3302b6` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/newton-second-law.jpg` | 512×512 | 7855 | `c466f11392627a3b62bab992c2aaceee0d46a3d680f94fe1aadbc3a5a58bf075` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/noise.jpg` | 512×512 | 19143 | `889aa6ef1316704e4a260c38a64e218b615d14becba2f07ee6d6635ba378c453` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/parallel-circuit.jpg` | 512×512 | 12046 | `0ca23162cf71dbd471596263f346ad495452a85d03a57a7e2a4f3e3b5044a5e4` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/parallel-plate.jpg` | 512×512 | 14858 | `d4e31cde2c736ee12a28fec9c77e9ef144e82576309e5238db6db5643294a3e5` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/photoelectric-effect.jpg` | 512×512 | 19487 | `841bee94df05c7e126a703c6a2dca91819186e3a36f64377040880060ca316d1` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/pinhole.jpg` | 512×512 | 18650 | `c22efa906c68b0aab6332594bbb1e0ee56646b5d4792713eab1f7ac6186724c7` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/plane-mirror.jpg` | 512×512 | 11221 | `ac069df37c5ea3e6aea1d5d16bdc79e2abf3ff026900994e2afa4307892ae324` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/point-charge.jpg` | 512×512 | 11769 | `13f3cef4addead4257641860bf0a763fcd120c3d7ea7f2246c41126df1b01ffb` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/projectile-horizontal.jpg` | 512×512 | 8998 | `9bd0fddf3b6bdff2b93228948f6a8c30c25525044dd46a365dc1bf24e6b8a53b` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/projectile-oblique.jpg` | 512×512 | 8517 | `4f63465d0417fe85810e1e88ec097f8e12c65e10d0372febe5909a36c0affb31` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/question.jpg` | 512×512 | 16085 | `9bdbbd8f8a7771bf6101f0fe35418f96d07ef0d02277883e26190953c7cfb323` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/ramp-friction.jpg` | 512×512 | 22006 | `70f81ba426ad2743569189be9f497e536925863c9e1ec260718a9a0391752317` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/rheostat-circuit.jpg` | 512×512 | 15382 | `c8856f16254eb2e11dd9f0a9bc40cdd54e6b4f5895c70d5311e8db051b43bceb` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/series-circuit.jpg` | 512×512 | 13635 | `1b857ef751207721d392f28292ff0764cba9d08d5cbde758de1f5cc804babaa5` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/short-circuit.jpg` | 512×512 | 19894 | `092d5cfece2ac976c1dac409aa1d469f5b5271dedb0351b7e9e63d6699c23808` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/simple-pendulum.jpg` | 512×512 | 17142 | `c6957a82d11d2612573769ccbcca29a6127396c78241275077a3f2499eacd197` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/solenoid-field.jpg` | 512×512 | 27206 | `559bde56a6a6a6cdc7236ba691faf46e3886367e3bf12b7b3f8370f7007a415a` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/solid-pressure.jpg` | 512×512 | 16510 | `93d2544f14a1e73eb0295a99ae45db55a795911c2bf8a5b55df2a10a909263ee` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/spring-oscillator.jpg` | 512×512 | 20532 | `5f0dfb8c2e3b0f8f6bb3f5294f246a152a19477f07ae156eade662df64bab5ca` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/straight-wire-field.jpg` | 512×512 | 20597 | `8de3c1ef4a5f56696c99344f7db27fd5a89e6866b92e84e0fcbe2cc7118ba0dd` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/thermometer.jpg` | 512×512 | 16487 | `b0543dd69ff6428fc1a45713d0a620c5eaee17808a02fd8b8015ccf1eea0d527` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/total-reflection.jpg` | 512×512 | 20561 | `6cecdd81283a22a5a13703ec2913f5f21d661315f6eb25e4531821322dd2fbfc` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/transformer.jpg` | 512×512 | 25299 | `db42d4274e90a6e200251ebb8d579fb0cef314c81133ecb1abedd03f1479e0d8` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/uniform-acceleration.jpg` | 512×512 | 9025 | `dfcb00f32cd4e9fa4e85f0bde965e89b69d5b0813086875e113299d27bed89d3` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/uniform-electric.jpg` | 512×512 | 9118 | `d997f3ba99a35a42dc1a3a4ced3815010a8eeb20197f0d2d3854dccf07f7964c` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/uniform-linear.jpg` | 512×512 | 9397 | `fd0bb68f391466f139ad25485d7ec2491d69db26a5fb66e2e82c0bf76580b812` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/va-resistance.jpg` | 512×512 | 12629 | `71fcc93bd9d521f510536023fbc1057c5c53e6d642cf69f0aa4fd098cf0417b2` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/velocity-selector.jpg` | 512×512 | 11409 | `71cba1f76ae86977e3fa7255d2c0d92b0e60764d26d764a42e56bc6c96c07ed1` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/vt-area.jpg` | 512×512 | 21486 | `3507fb1edf871647168f700e32c77f2e39dccfe03011ce4c58ce00e0e3749502` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/wave-diffraction.jpg` | 512×512 | 34265 | `7a6764e618e1cc9513388b625b226a61555f62a7d3519cf68d61823114dfb9ea` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/wave-doppler.jpg` | 512×512 | 23473 | `006a03c1916c1610280bbaa36f286b2dc703429b59e7414008d9f11742e4049d` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/wave-interference.jpg` | 512×512 | 14359 | `fe7cdac2e7ab4156864c106bb50a90a12ff988bd7d70bb7fdfabda2b66353e07` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/wave-longitudinal.jpg` | 512×512 | 19207 | `0f04c84037b6b0a45e5fd49e34ac0b3595d86082ff6c8480c383324486c12313` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/wave-reflection-refraction.jpg` | 512×512 | 21723 | `eda1974d76828d631b0a728426cfdf73aa6c458f551e578769faae482a152332` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/wave-standing.jpg` | 512×512 | 10660 | `52713b9074be5a1e80d7e9d8e0eded96e4613731370ceef1b3a6b25541d30561` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/experiment-art/wave-travelling.jpg` | 512×512 | 11918 | `f490d04dec4bce20240614e1d3ed32b95a78bb272402da24b3188e06ff6e6ba9` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/mascot/mascot-search-160.webp` | 141×160 | 17650 | `a998d4bd9674f3abd2662617bc83037226c34e5dbf0d18646ff063fbd34269c3` | 0 |
| `overlays/harness/files/apps/web/public/physicsos/mascot/mascot-search-320.webp` | 282×320 | 66076 | `8151f15b7b6743d18507a5e897424daf1ba9f936a4497a3d78627a564e5165c7` | 0 |
| `overlays/harness/files/apps/web/public/physicsos/mascot/mascot-search-640.webp` | 564×640 | 237294 | `41d3a821201caab4e6a0f3c77d25cee960e712d1b00ac3b5182f68abb5b10c1b` | 0 |
| `overlays/harness/files/apps/web/public/physicsos/mascot/mascot-think-160.webp` | 114×160 | 15142 | `5faef2a1385218da23f5d03943efd9c5524e03fd086106d0cf54b92b18619965` | 0 |
| `overlays/harness/files/apps/web/public/physicsos/mascot/mascot-think-320.webp` | 228×320 | 60650 | `859c87f31918fb44816de761f5ec4607f415ee0b7bb8905ea82a6e3757275cbb` | 0 |
| `overlays/harness/files/apps/web/public/physicsos/mascot/mascot-think-640.webp` | 457×640 | 230256 | `f60d0555d3a13228770ac271bae40b400ecd6a3853773cd8f80e6a4a1287baf8` | 0 |
| `overlays/harness/files/apps/web/public/physicsos/mascot/mascot-wave-160.webp` | 127×160 | 16664 | `3d4c00f874cd25a87b407329ef0e59ce83032df1d56aa0f064e6f2f706a13b65` | 0 |
| `overlays/harness/files/apps/web/public/physicsos/mascot/mascot-wave-320.webp` | 254×320 | 67242 | `4961adec6bddae01c95e69040c23791682120c719c35574d9b22b7d6cdad5707` | 0 |
| `overlays/harness/files/apps/web/public/physicsos/mascot/mascot-wave-640.webp` | 509×640 | 258674 | `99e0d93b5a3e6974949c7accc1481ec5ff4b436cdb651e43e8d45cc74cae0e0d` | 0 |
| `overlays/harness/files/apps/web/public/physicsos/navigation/canvas.png` | 128×128 | 3765 | `2d12aafb09d44db569a07b6cd127278d15010f6fde23d24fbd15a67948bd3d80` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/navigation/projects.png` | 128×128 | 1617 | `2c0e25bc2313f09d7dfe4a35f7fc457de4280287ceb5deaaa75a13f3f8e94989` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/navigation/whiteboard.png` | 128×128 | 2758 | `e327dbff42979d222d6a1ae6a427363bd0542793f00fe1d5ac9a0b900a0a9818` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/website/assets/logo.png` | 128×128 | 18901 | `ed17753fa0b9f7a6d00d2d3259502408302179ab061892e56f2c325104b54d2f` | 1 |
| `overlays/harness/files/apps/web/public/physicsos/website/assets/mascot-glass.webp` | 800×800 | 39946 | `9f85e7bf6b5b1457ca063a110ad4d40f6edf83d1014a6e47608a1f07fac9c900` | 1 |
| `overlays/harness/files/packages/client/ui-physicsos/src/client/icons/physics-icons.tsx` | 24×24 | 27693 | `c6e89c69363d78d45c53ab2b1dc40c2b9b824688ba6eee2e29e39f14d59d930a` | 12 |
