import { Composition } from 'remotion'
import { FPS, TOTAL_FRAMES } from './cues'
import { Promo } from './Promo'
import { FPS as FPS4, TOTAL_FRAMES as TOTAL_FRAMES4 } from './v4/cues'
import { Promo4 } from './v4/Promo4'

export const RemotionRoot = () => (
  <>
    <Composition id="PhysicsOSPromo" component={Promo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
    <Composition id="PhysicsOSPromoV4" component={Promo4} durationInFrames={TOTAL_FRAMES4} fps={FPS4} width={1920} height={1080} defaultProps={{ bgm: true }} />
  </>
)
