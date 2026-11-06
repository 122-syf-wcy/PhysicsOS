/** Data-only contract copied from client universal-contract.ts and physics/scene-visual-model.ts.
 * Keep field shapes aligned with those sources; never include solver/default/drawing implementations. */
export const QUESTION_CODE_RENDER_CONTRACT = `Independent private question renderer data contract (V3)

Export renderFrame(snapshot). The trusted SDK calls this on every verified frame and awaits it before acknowledging the original frameId/revision. There is no renderer factory or platform draw function. Use document.getElementById('canvas'), an otherwise empty full-viewport div, as the authored stage. Create and size your own Canvas 2D or browser-native SVG there. Your renderer module must have zero imports (including dynamic imports/reexports); use native browser APIs and local helpers. Read snapshot.view and draw meaningful experiment geometry. A background alone or an empty wrapper is invalid. Keep title/status/parameters SDK elements intact; the shell hides them. The frozen baseline sets viewport/font defaults; your exact stylesheet loads afterwards.

For your own authored controls, call document.dispatchEvent(new CustomEvent('physicsos-experiment-intent', { detail: intent })). The frozen private bootstrap forwards this through the existing authenticated V3 SDK, which validates and sends it over its single MessagePort; never import the SDK, contact parent directly or mutate snapshots locally. Parent controls use the same platform runtime. Every intent must carry protocolVersion: 3 and exactly one of these shapes:
{type:'parameter/preview'|'parameter/commit',protocolVersion:3,id:string,value:number}
{type:'parameter/cancel',protocolVersion:3}
{type:'choice/set',protocolVersion:3,id:string,value:string}
{type:'observable/set',protocolVersion:3,key:string,enabled:boolean}
{type:'playback/running',protocolVersion:3,running:boolean}
{type:'playback/rate',protocolVersion:3,rate:number}
{type:'playback/seek',protocolVersion:3,time:number}
Use the current snapshot.inspector parameter/choice IDs and option values, and view.visible observable keys exactly. Use finite values within current parameter bounds. Playback rate must be exactly one of [0.25, 0.5, 1, 2], and seek must satisfy 0 <= time <= snapshot.clock.total. Send playback intents only for an engine timeline with snapshot.clock.total > 0; hide or disable playback controls when there is no timeline or the total duration is zero. Do not assume an empty events array means there is no timeline. Do not send extra fields. Let the next engine snapshot update the drawing, clock and readouts.

All received fields are plain finite JSON. snapshot.source is 'platform-engine'; snapshot.experimentId/revision identify the frame. snapshot.view is the SceneVisualModel below, produced by the existing verified runtime. Treat every snapshot field as read-only. Never reconstruct PhysicsScene, integrate motion, solve equations, fabricate trajectories/readings, or substitute another question's constants. Presentation geometry, material, layout, and coordinate projection are your responsibility.

Coordinates are scene units, y-up. view.origin is the LOWER-LEFT visible corner, view.extent its width/height. Use one uniform scene-to-screen scale and flip y once; preserve lengths/angles/aspect. All vectors.from/to are pre-scaled DISPLAY arrow endpoints, not velocity/acceleration/force numbers: project them without extra physical scaling. Display actual magnitudes from view.overlay.readout or snapshot.inspector[].derived (already formatted strings) and values from inspector[].parameters. Never label an arrow's endpoint difference in m/s or N. Body sizes, wave displacements, thermal columns, coil loop counts and glyph spacings may already be display-scaled; use supplied primitives rather than deriving them.

snapshot.clock.time and clock.total are scene seconds, with running:boolean and rate:number. A new snapshot supplies current positions at the engine's current clock time. snapshot.trajectoryTimes contains engine sample times (may be empty); do not invent equal-time labels. Trajectory point arrays are already supplied in travel/sample order; history and predicted are different visual layers. Arrays may be empty, optional domain fields may be absent, and zero vectors are valid (including at an apex). view.visible names observable visibility; preserve upstream omissions/visibility. view.highlighted lists selected primitive ids. Labels/readouts and inspector results are engine-owned text.

Domain field guide (only draw primitives actually present):
mechanics: bodies/vectors/trajectories/ground/incline/platform/spring/pendulum/motionMarks/apparatus/coordinate/leverBeam/leverFulcrum/leverHangers/energyRamp/energyBar.
magnetic: particles/vectors/trajectories/center/field/guides/currentRig/currentWire/currentFieldCircles/currentProbes/currentCoil/currentCore/currentRotor/currentFieldLines.
electric: particles/vectors/trajectories/electricField/pointChargeSources/fieldStreamlines/probe/equipotentials/plates/boundedField.
composite: particles/vectors/trajectories/compositeRegions/field/electricField.
circuit: circuitComponents/circuitWires/circuitJunctions/chargeFlows, transformerCoils/transformerCore when present.
optics: opticalObjects/opticalElements/opticalImages/opticalRays/opticalScreens/opticalAxisMarks/lightRig/lightRefraction.
acoustics: acousticSources/acousticReflectors/acousticPulse/acousticWavefronts/noiseRig.
fluid: fluidLiquid/fluidBlock/fluidScale/pressureRig/pressureSolid/pressureLiquid/pressureComparisonLiquid/pressureProbes/pressureBarometer/pressureHemispheres.
thermal: thermalSample/thermalThermometer/thermalHeater and thermalComparisonSample/thermalComparisonThermometer/thermalComparisonHeater; thermometer when present.
induction: inductionField/inductionBar/inductionResistor/inductionRails/inductionPairBars/inductionForceArrows/inductionCoil/inductionCurrent/chargeFlows.
wave: waveProfile/waveMarker/waveSources/wavePoint/waveNodes/waveEnvelope/waveFronts/vectors.
modern: shared particles/trajectories/labels/overlay; there is no separate photoelectric or modern apparatus field.

Exact field shapes (TypeScript notation describes data; do not import these types):
interface UniversalExperimentSnapshot {
experimentId: string
revision: number
source: 'platform-engine'
domain: PhysicsDomainId
title: string
ariaLabel: string
view: SceneVisualModel
inspector: readonly InspectorSection[]
clock: PlaybackClock
table: DataTableView
charts: readonly ChartSeries[]
verification: readonly VerificationCheckView[]
events: readonly TimelineEvent[]
trajectoryTimes: readonly number[]
}
interface ScenePoint {
x: number
y: number
}

type PhysicsDomainId =
| 'magnetic'
| 'mechanics'
| 'electric'
| 'circuit'
| 'composite'
| 'optics'
| 'acoustics'
| 'fluid'
| 'thermal'
| 'induction'
| 'wave'
| 'modern'

type PhysicsSemanticRole =
| 'velocity'
| 'velocity-component'
| 'force'
| 'gravity'
| 'normal'
| 'friction'
| 'net-force'
| 'acceleration'
| 'trajectory'
| 'field'
| 'measurement'
| 'neutral'
| 'electric-force'
| 'magnetic-force'
| 'spring'
| 'tension'

type ObservableKey =
| 'velocity'
| 'force'
| 'trajectory'
| 'center'
| 'radius'
| 'guides'
| 'acceleration'
| 'components'
| 'keyPoints'
| 'forces'
| 'netForce'
| 'decomposition'
| 'electricField'
| 'energy'
| 'potential'
| 'equipotentials'
| 'electricForce'
| 'magneticForce'
| 'gravityForce'
| 'magneticField'
| 'regions'
| 'current'
| 'voltage'
| 'power'
| 'rays'
| 'image'
| 'wavefronts'
| 'path'
| 'photonEnergy'
| 'photocurrent'
| 'stoppingPotential'
| 'displaced'
| 'pressure'
| 'pressureComparison'
| 'thermometer'
| 'phase'
| 'moments'
| 'arms'
| 'emf'
| 'inductionCurrent'
| 'flux'
| 'barMotion'
| 'waveform'
| 'waveSpeed'
| 'superposition'
| 'nodes'
| 'fieldLines'
| 'fieldComparison'
| 'energyConversion'
| 'lightRays'

type ObservableVisibility = Readonly<Partial<Record<ObservableKey, boolean>>>

interface BodyVisual {
id: string
kind: 'block' | 'ball' | 'cart' | 'weight-hook'
at: ScenePoint
size: number
rotation?: number
live?: boolean
label?: string
}

interface MotionMarkVisual {
id: string
at: ScenePoint
label?: string
}

interface GroundVisual {
y: number
from: number
to: number
label?: string
}

interface InclineVisual {
origin: ScenePoint
base: number
angle: number
points?: readonly ScenePoint[]
}

interface PlatformVisual {
at: ScenePoint
width: number
height: number
}

interface SpringVisual {
id: string
anchor: ScenePoint
end: ScenePoint
naturalLength: number
axis: 'horizontal' | 'vertical'
equilibrium?: number
}

interface PendulumVisual {
id: string
pivot: ScenePoint
bob: ScenePoint
length: number
}

interface ApparatusSpriteVisual {
id: string
part: string
at: ScenePoint
size: number
width?: number
flip?: boolean
}

interface TrajectoryVisual {
id: string
kind: 'history' | 'predicted'
points: readonly ScenePoint[]
direction?: 'clockwise' | 'counterclockwise'
}

interface VectorVisual {
id: string
role: PhysicsSemanticRole
observable: ObservableKey
from: ScenePoint
to: ScenePoint
symbol: string
subordinate?: boolean
labelHint?: 'auto' | 'start' | 'end'
}

interface AngleVisual {
id: string
at: ScenePoint
radius: number
startAngle: number
endAngle: number
symbol: string
value?: string
}

interface DimensionVisual {
id: string
from: ScenePoint
to: ScenePoint
label: string
side?: 'left' | 'right'
}

interface KeyPointVisual {
id: string
kind: 'launch' | 'apex' | 'impact' | 'sample'
at: ScenePoint
label: string
readout?: readonly { label: string; value: string }[]
}

interface CoordinateVisual {
at: ScenePoint
length: number
xLabel: string
yLabel: string
rotation?: number
}

interface LabelVisual {
id: string
at: ScenePoint
text: string
role?: PhysicsSemanticRole
anchor?: 'start' | 'middle' | 'end'
}

interface MeasurementVisual {
label: string
length: number
}

interface FieldVisual {
direction: 'into-page' | 'out-of-page'
spacing: number
}

interface ElectricFieldVisual {
direction: ScenePoint
spacing: number
}

interface PointChargeSourceVisual {
id: string
at: ScenePoint
sign: 'positive' | 'negative'
radius: number
chargeValue: number
}

interface FieldStreamlineVisual {
id: string
points: readonly ScenePoint[]
arrowAt: ScenePoint
sourceId?: string
}

interface EquipotentialVisual {
id: string
level: number
points: readonly ScenePoint[]
closed: boolean
}

interface ProbeVisual {
id: string
at: ScenePoint
}

interface PlateVisual {
id: string
at: ScenePoint
length: number
top: boolean
sign?: 'positive' | 'negative'
}

interface BoundedFieldVisual {
at: ScenePoint
width: number
height: number
direction: ScenePoint
spacing: number
}

interface ParticleVisual {
id: string
at: ScenePoint
sign: 'positive' | 'negative'
radius: number
symbol: string
}

interface CompositeRegionVisual {
id: string
at: ScenePoint
width: number
height: number
kind: 'selector' | 'transition' | 'deflection' | 'generic'
label: string
electricField?: ElectricFieldVisual
magneticField?: FieldVisual
}

type CircuitSymbolKind =
'resistor' | 'voltage_source' | 'switch' | 'ammeter' | 'voltmeter' | 'variable_resistor'

interface CircuitComponentVisual {
id: string
kind: CircuitSymbolKind
at: ScenePoint
rotation: number
label: string
value?: string
ratingValue?: number
reading?: string
voltageText?: string
powerText?: string
currentText?: string
currentDirection?: 'forward' | 'reverse'
closed?: boolean
sliderPosition?: number
glow?: number
}

interface CircuitWireVisual {
id: string
points: readonly ScenePoint[]
}

interface ChargeFlowVisual {
id: string
path: readonly ScenePoint[]
current: number
}

interface CircuitJunctionVisual {
id: string
at: ScenePoint
branch?: true
}

interface GuideVisual {
id: string
observable: ObservableKey
from: ScenePoint
to: ScenePoint
label?: string
}

interface OpticalObjectVisual {
id: string
at: ScenePoint
height: number
label?: string
}

interface OpticalElementVisual {
id: string
kind: 'thin_lens' | 'plane_mirror' | 'curved_mirror'
at: ScenePoint
halfAperture: number
curvature?: 'concave' | 'convex'
label?: string
}

interface OpticalAxisMarkVisual {
id: string
at: ScenePoint
label: string
}

interface OpticalImageVisual {
id: string
at: ScenePoint
height: number
nature: 'real' | 'virtual'
label?: string
}

interface OpticalRayVisual {
id: string
kind: 'parallel' | 'central' | 'focal' | 'incident'
points: readonly ScenePoint[]
extension?: readonly ScenePoint[]
}

interface OpticalScreenVisual {
id: string
at: ScenePoint
halfHeight: number
lit: boolean
label?: string
}

interface AcousticSourceVisual {
id: string
at: ScenePoint
label?: string
}

interface AcousticReflectorVisual {
id: string
at: ScenePoint
halfHeight: number
label?: string
}

interface AcousticPulseVisual {
id: string
at: ScenePoint
phase: 'outbound' | 'return' | 'received'
}

interface AcousticWavefrontVisual {
id: string
at: ScenePoint
radius: number
direction: 'forward' | 'backward'
}

interface FluidLiquidVisual {
id: string
left: number
right: number
surface: number
floor: number
label?: string
}

interface FluidBlockVisual {
id: string
at: ScenePoint
halfWidth: number
halfHeight: number
submergedTop: number
phase: 'dry' | 'entering' | 'submerged' | 'floating'
label?: string
}

interface FluidScaleVisual {
id: string
at: ScenePoint
reading: string
dialFraction?: number
label?: string
}

type PressureRigKind = 'solid' | 'liquid' | 'atmospheric'

interface PressureFaceVisual {
id: string
at: ScenePoint
halfWidth: number
pressureText: string
loaded: boolean
}

interface PressureSolidVisual {
id: string
at: ScenePoint
halfWidth: number
halfHeight: number
plateDepth: number
forceText: string
faces: readonly PressureFaceVisual[]
label?: string
}

interface PressureLiquidVisual {
id: string
left: number
right: number
surface: number
floor: number
rim: number
densityText: string
label?: string
}

interface PressureProbeVisual {
id: string
at: ScenePoint
readingText: string
depth: number
surface: number
primary: boolean
}

interface PressureBarometerVisual {
id: string
at: ScenePoint
halfWidth: number
dishHalfWidth: number
dishDepth: number
surface: number
columnTop: number
tubeTop: number
columnText: string
pressureText: string
label?: string
}

interface PressureHemisphereVisual {
id: string
at: ScenePoint
radius: number
forceText: string
label?: string
}

type CurrentRigKind = 'straight_wire' | 'solenoid' | 'electromagnet' | 'motor'

interface CurrentWireVisual {
id: string
at: ScenePoint
currentText: string
direction: 1 | -1
label?: string
}

interface CurrentFieldCircleVisual {
id: string
center: ScenePoint
radius: number
circulation: 1 | -1
probe: boolean
}

interface CurrentProbeVisual {
id: string
at: ScenePoint
readingText: string
primary: boolean
}

interface CurrentCoilVisual {
id: string
at: ScenePoint
halfLength: number
radius: number
loopCount: number
currentText: string
fieldText: string
northPole: 1 | -1
turnsText: string
comparisonTurnsText?: string
label?: string
}

interface CurrentCoreVisual {
id: string
at: ScenePoint
halfLength: number
halfHeight: number
northPole: 1 | -1
armatureHalfWidth: number
armatureHalfHeight: number
coreText: string
airFieldText: string
pullText: string
heldMassText: string
comparisonCoreText?: string
comparisonPullText?: string
label?: string
}

interface MotorRotorVisual {
id: string
at: ScenePoint
sides: readonly ScenePoint[]
forces: readonly { readonly id: string; readonly from: ScenePoint; readonly to: ScenePoint }[]
halfWidth: number
angle: number
sense: 1 | -1
torqueText: string
forceText: string
currentText: string
turnsText: string
angleText: string
fieldText: string
label?: string
}

interface CurrentFieldLineVisual {
id: string
points: readonly ScenePoint[]
probe: boolean
arrowAt?: readonly number[]
}

type EnergyRole = 'potential' | 'kinetic' | 'thermal'

interface EnergySegmentVisual {
id: string
role: EnergyRole
text: string
fraction: number
}

interface EnergyBarVisual {
id: string
at: ScenePoint
width: number
height: number
segments: readonly EnergySegmentVisual[]
totalText: string
label?: string
}

interface EnergyRampVisual {
id: string
base: ScenePoint
peak: ScenePoint
height: number
cartLength: number
cartHalfHeight: number
heightText: string
rampText: string
potentialText: string
kineticText: string
thermalText: string
speedText: string
label?: string
}

interface LightRigVisual {
id: string
at: ScenePoint
objectAt: ScenePoint
objectHalfHeight: number
screenAt: ScenePoint
screenHalfHeight: number
cardHalfHeight: number
imageFrom: ScenePoint
imageTo: ScenePoint
rays: readonly { readonly id: string; readonly points: readonly ScenePoint[] }[]
objectText: string
imageText: string
magnificationText: string
distanceText: string
screenText: string
label?: string
}

interface LightRefractionVisual {
id: string
at: ScenePoint
boundaryFrom: ScenePoint
boundaryTo: ScenePoint
normalFrom: ScenePoint
normalTo: ScenePoint
incidentFrom: ScenePoint
reflectedTo: ScenePoint
refractedTo?: ScenePoint
criticalTo?: ScenePoint
total: boolean
incidentText: string
refractedText: string
criticalText: string
indicesText: string
label?: string
}

interface NoiseRigVisual {
id: string
sourceAt: ScenePoint
listenerAt: ScenePoint
distance: number
barrierAt?: ScenePoint
wavefronts: readonly number[]
levelText: string
sourceText: string
distanceText: string
barrierText: string
comparisonText: string
label?: string
}

interface ThermometerVisual {
id: string
at: ScenePoint
halfWidth: number
bulbRadius: number
columnTop: number
icePoint: number
steamPoint: number
span: number
temperatureText: string
scaleText: string
fixedPointsText: string
spanText: string
columnText: string
label?: string
}

interface TransformerCoilVisual {
id: string
at: ScenePoint
halfWidth: number
halfHeight: number
turnsLoops: number
spacing: number
voltageText: string
currentText: string
turnsText: string
primary: boolean
}

interface TransformerCoreVisual {
id: string
from: ScenePoint
to: ScenePoint
halfHeight: number
ratioText: string
powerText: string
stepsUp: boolean
label?: string
}

interface ThermalSampleVisual {
id: string
at: ScenePoint
halfWidth: number
halfHeight: number
meltedFraction: number
phase: 'solid' | 'melting' | 'liquid' | 'boiling'
label?: string
}

interface ThermalThermometerVisual {
id: string
at: ScenePoint
columnHeight: number
reading: string
label?: string
}

interface ThermalHeaterVisual {
id: string
at: ScenePoint
halfWidth: number
power: string
label?: string
}

interface LeverBeamVisual {
id: string
from: ScenePoint
to: ScenePoint
tilt: number
}

interface LeverFulcrumVisual {
id: string
at: ScenePoint
}

interface LeverHangerVisual {
id: string
side: 'left' | 'right'
attach: ScenePoint
massAt: ScenePoint
label: string
massText: string
}

interface InductionFieldVisual {
id: string
origin: ScenePoint
size: { width: number; height: number }
marks: 'into' | 'out'
}

interface InductionBarVisual {
id: string
at: ScenePoint
length: number
label: string
direction: 1 | -1
}

interface InductionResistorVisual {
id: string
at: ScenePoint
span: number
label: string
}

interface InductionRailVisual {
id: string
from: ScenePoint
to: ScenePoint
}

interface InductionPairBarVisual {
id: string
at: ScenePoint
length: number
label: string
}

interface InductionForceArrowVisual {
id: string
at: ScenePoint
direction: 1 | -1
length: number
label: string
}

interface InductionCoilVisual {
id: string
at: ScenePoint
diameter: number
label: string
}

interface InductionCurrentVisual {
id: string
from: ScenePoint
to: ScenePoint
sign: number
}

interface WaveProfileVisual {
id: string
kind: 'rope' | 'string'
points: readonly ScenePoint[]
equilibrium: { from: ScenePoint; to: ScenePoint }
}

interface WaveMarkerVisual {
id: string
at: ScenePoint
label: string
}

interface WaveSourceVisual {
id: string
at: ScenePoint
label: string
}

interface WavePointVisual {
id: string
at: ScenePoint
verdict: 'constructive' | 'destructive' | 'partial'
readout: string
}

interface WaveNodeVisual {
id: string
kind: 'node' | 'antinode'
at: ScenePoint
label?: string
}

interface WaveEnvelopeVisual {
id: string
upper: readonly ScenePoint[]
lower: readonly ScenePoint[]
}

interface WaveFrontVisual {
id: string
center: ScenePoint
radius: number
}

interface CanvasOverlay {
readout: readonly string[]
scale: MeasurementVisual
}

interface SceneVisualModel {
domain: PhysicsDomainId
extent: { width: number; height: number }
origin: ScenePoint
grid: { minor: number; major: number }
axes: { x: string; y: string }
tickStep?: number
tickLabelAvoid?: { x?: readonly [number, number]; y?: readonly [number, number] }
bodies: readonly BodyVisual[]
particles: readonly ParticleVisual[]
vectors: readonly VectorVisual[]
trajectories: readonly TrajectoryVisual[]
keyPoints: readonly KeyPointVisual[]
angles: readonly AngleVisual[]
dimensions: readonly DimensionVisual[]
labels: readonly LabelVisual[]
guides: readonly GuideVisual[]
ground?: GroundVisual
incline?: InclineVisual
platform?: PlatformVisual
spring?: SpringVisual
pendulum?: PendulumVisual
apparatus?: readonly ApparatusSpriteVisual[]
motionMarks?: readonly MotionMarkVisual[]
coordinate?: CoordinateVisual
field?: FieldVisual
electricField?: ElectricFieldVisual
pointChargeSources?: readonly PointChargeSourceVisual[]
fieldStreamlines?: readonly FieldStreamlineVisual[]
probe?: ProbeVisual
equipotentials?: readonly EquipotentialVisual[]
plates?: readonly PlateVisual[]
boundedField?: BoundedFieldVisual
compositeRegions?: readonly CompositeRegionVisual[]
circuitComponents?: readonly CircuitComponentVisual[]
circuitWires?: readonly CircuitWireVisual[]
circuitJunctions?: readonly CircuitJunctionVisual[]
chargeFlows?: readonly ChargeFlowVisual[]
opticalObjects?: readonly OpticalObjectVisual[]
opticalElements?: readonly OpticalElementVisual[]
opticalImages?: readonly OpticalImageVisual[]
opticalRays?: readonly OpticalRayVisual[]
opticalScreens?: readonly OpticalScreenVisual[]
opticalAxisMarks?: readonly OpticalAxisMarkVisual[]
acousticSources?: readonly AcousticSourceVisual[]
acousticReflectors?: readonly AcousticReflectorVisual[]
acousticPulse?: AcousticPulseVisual
acousticWavefronts?: readonly AcousticWavefrontVisual[]
fluidLiquid?: FluidLiquidVisual
fluidBlock?: FluidBlockVisual
fluidScale?: FluidScaleVisual
pressureRig?: PressureRigKind
pressureSolid?: PressureSolidVisual
pressureLiquid?: PressureLiquidVisual
pressureComparisonLiquid?: PressureLiquidVisual
pressureProbes?: readonly PressureProbeVisual[]
pressureBarometer?: PressureBarometerVisual
pressureHemispheres?: PressureHemisphereVisual
currentRig?: CurrentRigKind
currentWire?: CurrentWireVisual
currentFieldCircles?: readonly CurrentFieldCircleVisual[]
currentProbes?: readonly CurrentProbeVisual[]
currentCoil?: CurrentCoilVisual
currentCore?: CurrentCoreVisual
currentRotor?: MotorRotorVisual
energyRamp?: EnergyRampVisual
energyBar?: EnergyBarVisual
lightRig?: LightRigVisual
lightRefraction?: LightRefractionVisual
transformerCoils?: readonly TransformerCoilVisual[]
transformerCore?: TransformerCoreVisual
thermometer?: ThermometerVisual
noiseRig?: NoiseRigVisual
currentFieldLines?: readonly CurrentFieldLineVisual[]
thermalSample?: ThermalSampleVisual
thermalThermometer?: ThermalThermometerVisual
thermalHeater?: ThermalHeaterVisual
thermalComparisonSample?: ThermalSampleVisual
thermalComparisonThermometer?: ThermalThermometerVisual
thermalComparisonHeater?: ThermalHeaterVisual
leverBeam?: LeverBeamVisual
leverFulcrum?: LeverFulcrumVisual
leverHangers?: readonly LeverHangerVisual[]
inductionField?: InductionFieldVisual
inductionBar?: InductionBarVisual
inductionResistor?: InductionResistorVisual
inductionRails?: readonly InductionRailVisual[]
inductionPairBars?: readonly InductionPairBarVisual[]
inductionForceArrows?: readonly InductionForceArrowVisual[]
inductionCoil?: InductionCoilVisual
inductionCurrent?: InductionCurrentVisual
waveProfile?: WaveProfileVisual
waveMarker?: WaveMarkerVisual
waveSources?: readonly WaveSourceVisual[]
wavePoint?: WavePointVisual
waveNodes?: readonly WaveNodeVisual[]
waveEnvelope?: WaveEnvelopeVisual
waveFronts?: readonly WaveFrontVisual[]
center?: ScenePoint
overlay: CanvasOverlay
visible: ObservableVisibility
highlighted?: readonly string[]
}

interface QuantityParameter {
id: string
label: string
symbol: string
unit: string
value: number
min?: number
max?: number
step?: number
highlights?: string
}

interface DerivedQuantityView {
id: string
label: string
symbol: string
value: string
unit: string
highlights?: string
}

interface InspectorSection {
id: string
title: string
parameters?: readonly QuantityParameter[]
derived?: readonly DerivedQuantityView[]
choices?: readonly {
id: string
label: string
value: string
options: readonly { value: string; label: string }[]
}[]
}

interface ChartSeries {
id: string
title: string
xLabel: string
yLabel: string
points: readonly { t: number; value: number }[]
role: PhysicsSemanticRole
}

interface DataSampleRow {
step: number
values: readonly string[]
}

interface DataTableView {
columns: readonly string[]
rows: readonly DataSampleRow[]
}

interface TimelineEvent {
id: string
time: number
label: string
kind: 'launch' | 'apex' | 'impact' | 'enter' | 'exit' | 'plate-impact' | 'generic'
}

interface PlaybackClock {
time: number
total: number
running: boolean
rate: number
}

interface VerificationCheckView {
id: string
label: string
status: 'passed' | 'warning' | 'failed'
detail?: string
}`
