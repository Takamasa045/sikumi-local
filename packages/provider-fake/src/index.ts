export {
  createFakeProvider,
  FAKE_PROVIDER_CAPABILITIES,
  FAKE_PROVIDER_DISPLAY_NAME,
} from './fake-provider.js'
export {
  assertSupportedFakeProtocol,
  FAKE_SUPPORTED_PROTOCOL_VERSION,
  loadFakeProtocolFixture,
  resolveFakeProtocolFixture,
} from './protocol.js'
export { mapFakeProcessEvent } from './map-event.js'
export {
  scenarioFromPrompt,
  type FakeScenario,
  fakeScenarios,
} from './scenario.js'
