import { describe, expect, it } from '@jest/globals';
import { getAgentCard } from './agent-card.js';

describe('A2A AgentCard', () => {
  const card = getAgentCard('http://localhost:4113');

  it('has correct name and version', () => {
    expect(card.name).toBe('Asklepios');
    expect(card.version).toBe('0.4.0');
  });

  it('has valid protocol version', () => {
    expect(card.protocolVersion).toBe('0.3.0');
  });

  it('has correct URL', () => {
    expect(card.url).toBe('http://localhost:4113/a2a');
  });

  it('uses custom baseUrl when provided', () => {
    const custom = getAgentCard('https://asklepios.example.com');
    expect(custom.url).toBe('https://asklepios.example.com/a2a');
  });

  it('has provider information', () => {
    expect(card.provider?.organization).toBe('Asklepios Project');
    expect(card.provider?.url).toContain('github.com');
  });

  describe('skills', () => {
    it('has 6 skills', () => {
      expect(card.skills.length).toBe(6);
    });

    it.each([
      'diagnose',
      'research',
      'phenotype',
      'cross-patient',
      'clinical-data',
      'adversarial-synthesis',
    ])('includes %s skill', (skillId) => {
      const skill = card.skills.find((s) => s.id === skillId);
      expect(skill).toBeDefined();
      expect(skill?.name).toBeTruthy();
      expect(skill?.description).toBeTruthy();
    });

    it('diagnose skill has examples', () => {
      const diagnose = card.skills.find((s) => s.id === 'diagnose');
      expect(diagnose?.examples?.length).toBeGreaterThan(0);
    });
  });

  describe('capabilities', () => {
    it('declares streaming support', () => {
      expect(card.capabilities.streaming).toBe(true);
    });

    it('declares state transition history', () => {
      expect(card.capabilities.stateTransitionHistory).toBe(true);
    });
  });

  describe('input/output modes', () => {
    it('supports text/plain input', () => {
      expect(card.defaultInputModes).toContain('text/plain');
    });

    it('supports text/plain output', () => {
      expect(card.defaultOutputModes).toContain('text/plain');
    });
  });
});
