
import React, { useState } from 'react';
import styled from 'styled-components';
import type { EmgLayer } from '../../types/schema';
import type { LoadedProject } from '../../core/ProjectLoader';
import { projectLoader } from '../../core/ProjectLoader';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  color: #eee;
`;

const Section = styled.div`
  background: #2a2a2a;
  padding: 0.5rem;
  border-radius: 4px;
`;

const Header = styled.h4`
    margin: 0 0 0.5rem 0;
    font-size: 0.9rem;
    color: #aaa;
`;

const PartRow = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.25rem 0;
    border-bottom: 1px solid #333;
    font-size: 0.8rem;

    &:last-child {
        border-bottom: none;
    }
`;

const Button = styled.button`
    background: #444;
    border: none;
    color: white;
    padding: 2px 6px;
    border-radius: 2px;
    cursor: pointer;
    font-size: 0.75rem;

    &:hover {
        background: #555;
    }
`;

interface VariantEditorProps {
    project: LoadedProject;
    currentStateName: string;
    // Callback to update project data
    onUpdate: (newProject: LoadedProject) => void;
}

export const VariantEditor: React.FC<VariantEditorProps> = ({ project, currentStateName, onUpdate }) => {
    const currentState = project.states.states.find(s => s.name === currentStateName);

    // For now, just edit the FIRST variant that matches the rules? 
    // Or list all variants?
    // v0.1: Let's assume user wants to edit the "Active" variant.
    // But StateMachine resolves matched variant based on runtime tags.
    // Ideally we list ALL variants in the state and let user pick one to edit.

    const [selectedVariantIndex, setSelectedVariantIndex] = useState<number>(0);

    if (!currentState) return <div>State not found</div>;

    const selectedVariant = currentState.variants[selectedVariantIndex];

    const handleReplaceTexture = async (partID: string, e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || !e.target.files[0]) return;
        if (!selectedVariant) return;

        const file = e.target.files[0];
        const blobUrl = URL.createObjectURL(file);

        // 1. Load image to get dimensions
        const img = new Image();
        img.src = blobUrl;
        await new Promise<void>((resolve) => {
            img.onload = () => {
                resolve();
            };
        });

        // Use Clone!
        const newProject = projectLoader.clone(project);

        // 2. Create New Texture
        const newTextureId = `custom_tex_${Date.now()}`;
        const newTexture = {
            id: newTextureId,
            src: `custom/${newTextureId}.png`,
            width: img.width,
            height: img.height
        };
        newProject.avatar.textures.push(newTexture);
        newProject.assets.set(newTexture.src, blobUrl);

        // 3. Create New Layer
        const newLayerId = `custom_layer_${Date.now()}`;
        const newLayer: EmgLayer = {
            layerID: newLayerId,
            partID: partID,
            textureID: newTextureId,
            x: 0,
            y: 0,
            width: newTexture.width,
            height: newTexture.height,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
            zIndex: 100,
        };

        // Find reference in NEW project (or old, doesn't matter for read)
        // We use newProject to find the variant since we are modifying newProject.
        // Wait, 'selectedVariant' variable is from PROPS project.
        // We need to find the equivalent variant in newProject.

        const stateIdx = newProject.states.states.findIndex(s => s.name === currentStateName);
        if (stateIdx === -1) return; // Should not happen

        const variantInNewProject = newProject.states.states[stateIdx].variants[selectedVariantIndex];
        const currentOverride = variantInNewProject.overrides?.[partID];

        const part = newProject.avatar.parts.find(p => p.partID === partID);
        const targetLayerID = currentOverride || part?.default;

        const referenceLayer = newProject.avatar.layers.find(l => l.layerID === targetLayerID);
        if (referenceLayer) {
            newLayer.x = referenceLayer.x;
            newLayer.y = referenceLayer.y;
            newLayer.zIndex = referenceLayer.zIndex;
        }

        newProject.avatar.layers.push(newLayer);

        // 4. Update Variant Override
        if (!variantInNewProject.overrides) variantInNewProject.overrides = {};
        variantInNewProject.overrides[partID] = newLayerId;

        onUpdate(newProject);
    };

    const handleSelectLayer = (partID: string, layerID: string) => {
        const newProject = projectLoader.clone(project);
        const stateIdx = newProject.states.states.findIndex(s => s.name === currentStateName);
        if (stateIdx === -1) return;

        const variantToUpdate = newProject.states.states[stateIdx].variants[selectedVariantIndex];
        if (!variantToUpdate.overrides) variantToUpdate.overrides = {};

        if (layerID === "") {
            delete variantToUpdate.overrides[partID];
        } else {
            variantToUpdate.overrides[partID] = layerID;
        }

        onUpdate(newProject);
    };

    const handleAddPart = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || !e.target.files[0]) return;

        const file = e.target.files[0];
        const blobUrl = URL.createObjectURL(file);

        // 1. Load image to get dimensions
        const img = new Image();
        img.src = blobUrl;
        await new Promise<void>((resolve) => {
            img.onload = () => resolve();
        });

        const newProject = projectLoader.clone(project);
        const timestamp = Date.now();

        // 2. Create Texture
        const newTextureId = `custom_tex_${timestamp}`;
        const newTexture = {
            id: newTextureId,
            src: `custom/${newTextureId}.png`,
            width: img.width,
            height: img.height
        };
        newProject.avatar.textures.push(newTexture);
        newProject.assets.set(newTexture.src, blobUrl);

        // 3. Create Part & Layer
        const newPartId = `part_${timestamp}`;
        // Calculate max Z.
        const maxZ = newProject.avatar.layers.reduce((max, l) => Math.max(max, l.zIndex), 0);
        const newZ = maxZ + 100;

        const newLayerId = `layer_${timestamp}`;

        const newPart = {
            partID: newPartId,
            type: 'static' as const,
            default: newLayerId,
            z: 0
        };
        newProject.avatar.parts.unshift(newPart); // Add to TOP

        const newLayer: EmgLayer = {
            layerID: newLayerId,
            partID: newPartId,
            textureID: newTextureId,
            x: 0,
            y: 0,
            width: newTexture.width,
            height: newTexture.height,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
            zIndex: newZ
        };
        newProject.avatar.layers.push(newLayer);

        onUpdate(newProject);
    };

    return (
        <Container>
            <Section>
                <Header>Variants ({currentState.variants.length})</Header>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {currentState.variants.map((v, idx) => (
                        <Button
                            key={idx}
                            style={{ background: selectedVariantIndex === idx ? '#007acc' : '#444' }}
                            onClick={() => setSelectedVariantIndex(idx)}
                        >
                            {Object.keys(v.tags).length > 0 ? JSON.stringify(v.tags) : 'Default'}
                        </Button>
                    ))}
                </div>
            </Section>

            {selectedVariant && (
                <Section>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <Header style={{ margin: 0 }}>Parts Overrides</Header>
                        <label>
                            <Button as="span" style={{ fontSize: '0.8rem' }}>+ Add Part</Button>
                            <input
                                type="file"
                                style={{ display: 'none' }}
                                accept="image/png,image/jpeg"
                                onChange={(e) => handleAddPart(e)}
                            />
                        </label>
                    </div>
                    <Header style={{ fontSize: '0.7em', color: '#666', fontWeight: 'normal', marginBottom: '0.5rem' }}>(Drag to Reorder)</Header>
                    {(() => {
                        // 1. Group layers by part and calculate max zIndex per part
                        const partMap = new Map<string, number>();
                        project.avatar.parts.forEach(p => {
                            const layers = project.avatar.layers.filter(l => l.partID === p.partID);
                            const maxZ = layers.length > 0 ? Math.max(...layers.map(l => l.zIndex)) : 0;
                            partMap.set(p.partID, maxZ);
                        });

                        // 2. Sort parts by Z-Index Descending (Top of list = Front = High Z)
                        const sortedParts = [...project.avatar.parts].sort((a, b) => {
                            const zA = partMap.get(a.partID) || 0;
                            const zB = partMap.get(b.partID) || 0;
                            return zB - zA;
                        });

                        // Drag Handlers
                        const handleDragStart = (e: React.DragEvent, index: number) => {
                            e.dataTransfer.setData('text/plain', index.toString());
                        };

                        const handleDragOver = (e: React.DragEvent) => {
                            e.preventDefault(); // Allow drop
                        };

                        const handleDrop = (e: React.DragEvent, dropIndex: number) => {
                            e.preventDefault();
                            const dragIndexStr = e.dataTransfer.getData('text/plain');
                            const dragIndex = parseInt(dragIndexStr, 10);
                            if (isNaN(dragIndex) || dragIndex === dropIndex) return;

                            // Clone Project First
                            const newProject = projectLoader.clone(project);

                            // We need to apply logic based on the *sorted order* we see in UI.
                            // The sorted order was derived from `project`.
                            // `newProject` has same data, so same sort order logic applies initially.

                            // Reorder the parts list conceptually
                            const newPartsOrder = [...sortedParts];
                            const [movedPart] = newPartsOrder.splice(dragIndex, 1);
                            newPartsOrder.splice(dropIndex, 0, movedPart);

                            // Update Z-Indices in newProject
                            const baseZ = 10000;
                            const stepZ = 100;

                            newPartsOrder.forEach((part, idx) => {
                                const partZBase = baseZ - (idx * stepZ);
                                // Find layers in newProject
                                const partLayers = newProject.avatar.layers.filter(l => l.partID === part.partID);
                                // Sort intra-part layers by their existing zIndex (from cloned project)
                                partLayers.sort((a, b) => a.zIndex - b.zIndex);

                                partLayers.forEach((l, layerIdx) => {
                                    l.zIndex = partZBase + layerIdx;
                                });
                            });

                            onUpdate(newProject);
                        };

                        return sortedParts.map((part, index) => {
                            const override = selectedVariant.overrides[part.partID];
                            const partLayers = project.avatar.layers.filter(l => l.partID === part.partID);

                            return (
                                <PartRow
                                    key={part.partID}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, index)}
                                    onDragOver={handleDragOver}
                                    onDrop={(e) => handleDrop(e, index)}
                                    style={{ cursor: 'grab' }}
                                >
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                            <span style={{ color: '#666' }}>::</span>
                                            <span>{part.partID}</span>
                                        </div>
                                        <span style={{ fontSize: '0.6rem', color: override ? '#88ff88' : '#666', paddingLeft: '14px' }}>
                                            {override ? `Overridden: ${override}` : 'Default'}
                                        </span>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        {/* Eye Icon */}
                                        <Button
                                            title={override === '__HIDDEN__' ? "Show Part" : "Hide Part"}
                                            onClick={() => {
                                                if (override === '__HIDDEN__') {
                                                    // Show (Remove override)
                                                    handleSelectLayer(part.partID, "");
                                                } else {
                                                    // Hide
                                                    handleSelectLayer(part.partID, "__HIDDEN__");
                                                }
                                            }}
                                            style={{
                                                padding: '2px 4px',
                                                background: override === '__HIDDEN__' ? '#552222' : '#333',
                                                color: override === '__HIDDEN__' ? '#888' : '#eee',
                                                border: 'none'
                                            }}
                                        >
                                            {override === '__HIDDEN__' ? '✕' : '👁'}
                                        </Button>

                                        <select
                                            style={{ background: '#333', color: '#eee', border: 'none', padding: '2px', maxWidth: '80px' }}
                                            value={override || ""}
                                            onChange={(e) => handleSelectLayer(part.partID, e.target.value)}
                                        >
                                            <option value="">(Default)</option>
                                            <option value="__HIDDEN__">(Hidden)</option>
                                            {partLayers.map(l => (
                                                <option key={l.layerID} value={l.layerID}>
                                                    {l.layerID}
                                                </option>
                                            ))}
                                        </select>

                                        <label>
                                            <Button as="span" title="Upload New Texture">+</Button>
                                            <input
                                                type="file"
                                                style={{ display: 'none' }}
                                                accept="image/png,image/jpeg"
                                                onChange={(e) => handleReplaceTexture(part.partID, e)}
                                            />
                                        </label>
                                    </div>
                                </PartRow>
                            );
                        });
                    })()}
                </Section>
            )}
        </Container>
    );
};
