// Blip portal compiler: Builder canvas model -> runtime ("Application") flow document.
//
// Faithful port of portal.js (Blip portal): TG.createModel -> iV.createModel per state ->
// setUpFlow -> setStateActions -> cleanKeysStartingWithDolar. Used for:
//   - subflows   (publishSubFlow: version 2, type "subflow")
//   - main flows (publishFlow:    version 1, type "flow", global actions as flow-level actions)
//
// Self-contained on purpose (no imports): patch-blip-sdk.mjs inlines this file into the SDK.

const PORTAL_META = {
    '#stateName': '{{state.name}}',
    '#stateId': '{{state.id}}',
    '#messageId': '{{input.message@id}}',
    '#previousStateId': '{{state.previous.id}}',
    '#previousStateName': '{{state.previous.name}}',
};

/** iV.createModel: one canvas state -> runtime state. */
export function portalCompileState(e) {
    const n = structuredClone(e);
    const s = {
        id: e.id,
        root: e.root,
        end: e.end,
        name: e.$title,
        shortNameOfSubflow: e.shortNameOfSubflow,
        deskStateVersion: e.deskStateVersion,
    };
    let onboardingSetVariables = [];
    if (e.id === 'onboarding' && e.$enteringCustomActions) {
        s.inputActions = n.$enteringCustomActions.filter((a) => a.type !== 'SetVariable');
        onboardingSetVariables = n.$enteringCustomActions.filter((a) => a.type === 'SetVariable');
    } else {
        s.inputActions = e.$enteringCustomActions ? n.$enteringCustomActions : [];
    }
    const content = n.$contentActions ?? [];
    const inputIndex = content.findIndex((a) => a.input != null);
    if (inputIndex >= 0) {
        if (inputIndex > 0) s.inputActions = s.inputActions.concat(content.slice(0, inputIndex).map((a) => a.action));
        s.input = content[inputIndex].input;
        s.outputActions = content.slice(inputIndex + 1).map((a) => a.action);
    } else {
        s.inputActions = s.inputActions.concat(content.map((a) => a.action));
        s.input = undefined;
        s.outputActions = [];
    }
    if (e.$leavingCustomActions) s.outputActions = s.outputActions.concat(n.$leavingCustomActions);
    if (e.id === 'onboarding' && onboardingSetVariables.length > 0) s.outputActions = s.outputActions.concat(onboardingSetVariables);
    if (e.id === 'onboarding') s.inputActions = s.inputActions.filter((a) => a.type !== 'SetVariable');
    s.afterStateChangedActions = [...(n.$afterStateChangedActions ?? [])];
    s.localCustomActions = (n.$localCustomActions ?? []).map((a) => ({
        id: a.$id,
        title: a.$title,
        type: a.type,
        settings: a.settings,
        conditions: a.conditions,
        order: a.order,
        continueOnError: a.continueOnError,
        description: a.$description,
    }));
    const outputs = n.$conditionOutputs ?? [];
    s.outputs = e.$defaultOutput ? outputs.concat(n.$defaultOutput) : outputs;
    return s;
}

function portalAddMetadata(action) {
    if (action?.type === 'TrackEvent') action.settings.extras = { ...action.settings.extras, ...PORTAL_META };
    if (['SendMessage', 'SendRawMessage', 'SendMessageFromHttp'].includes(action?.type)) {
        action.settings.metadata = { ...action.settings.metadata, ...PORTAL_META };
    }
}

/** setStateActions: metadata, optional auto state tracking, optional contacts journey. */
export function portalSetStateActions(states, configuration, journey) {
    for (const s of states) {
        s.inputActions.forEach(portalAddMetadata);
        s.outputActions.forEach(portalAddMetadata);
        if (configuration?.['builder:stateTrack'] === 'true') {
            const track = (m) => ({ type: 'TrackEvent', settings: { category: 'flow', action: s.name, extras: { stateId: s.id, ...m } } });
            if (s.root) s.outputActions = [track({ '#stateName': s.name, '#stateId': s.id, '#messageId': '{{input.message@id}}' })].concat(s.outputActions);
            else s.inputActions = [track(PORTAL_META)].concat(s.inputActions);
        }
        if (journey) {
            const trackJourney = (m) => ({
                type: 'TrackContactsJourney',
                settings: {
                    previousStateId: m['#previousStateId'],
                    previousStateName: m['#previousStateName'],
                    stateId: m['#stateId'],
                    stateName: m['#stateName'],
                },
            });
            if (s.root) s.outputActions = [trackJourney({ '#stateName': s.name, '#stateId': s.id })].concat(s.outputActions);
            else s.inputActions = [trackJourney(PORTAL_META)].concat(s.inputActions);
        }
    }
}

const portalStripDollar = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k.startsWith('$') ? undefined : x)));

/** True when the tenant has "track-contacts-journey" on, judged by what is live. */
export function portalJourneyEnabled(liveFlow) {
    return liveFlow ? JSON.stringify(liveFlow.states ?? []).includes('"TrackContactsJourney"') : undefined;
}

/**
 * The runtime flow of a MAIN flow (portal publishFlow). `globalActions` is the global-actions
 * state in canvas form; `journey` defaults to what the live flow shows.
 */
export function portalCompileFlow(flowId, draft, configuration, globalActions, journey) {
    const flow = {
        id: flowId,
        version: 1,
        states: Object.keys(draft).map((id) => portalCompileState(draft[id])),
        configuration,
    };
    const global = portalCompileState(globalActions ?? { id: 'global', $contentActions: [] });
    flow.inputActions = global.inputActions;
    flow.outputActions = global.outputActions;
    flow.type = 'flow';
    portalSetStateActions(flow.states, configuration, journey);
    return portalStripDollar(flow);
}

/** The runtime flow of a SUBFLOW (portal publishSubFlow). */
export function portalCompileSubflowFlow(flowId, draft, configuration, journey) {
    const flow = {
        id: flowId,
        version: 2,
        states: Object.keys(draft).map((id) => portalCompileState(draft[id])),
        configuration: configuration ?? {},
    };
    flow.type = 'subflow';
    portalSetStateActions(flow.states, flow.configuration, journey);
    return portalStripDollar(flow);
}
