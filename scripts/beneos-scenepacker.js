/**
 * Beneos ScenePacker Integration
 * 
 * Gère l'importation de packages ScenePacker depuis le serveur Beneos
 * via l'objet MoulinetteImporter de ScenePacker.
 * 
 * Utilise le Foundry ID de Beneos Cloud pour l'authentification.
 */

export class BeneosScenePackerManager {
    constructor() {
        this.serverUrl = 'https://beneos.cloud';
        this.apiEndpoint = `${this.serverUrl}/api-scenepacker.php`;
        this.sessionId = null; // En fait c'est le foundryId, mais on garde le nom pour compatibilité avec le code
    }

    /**
     * Initialise le manager avec le Foundry ID depuis les settings Beneos
     */
    async initialize() {
        console.log('BeneosScenePackerManager | Initializing...');
        
        // Récupérer le Foundry ID depuis les settings Beneos
        try {
            const foundryId = game.settings.get('beneos-module', 'beneos-cloud-foundry-id');
            if (foundryId && foundryId !== '') {
                this.sessionId = foundryId;
                console.log('BeneosScenePackerManager | Foundry ID retrieved from Beneos settings');
                return true;
            }
        } catch (e) {
            console.warn('BeneosScenePackerManager | Could not retrieve Foundry ID from Beneos settings:', e);
        }
        
        console.warn('BeneosScenePackerManager | No Foundry ID available - please connect to Beneos Cloud');
        return false;
    }

    /**
     * Liste tous les packages ScenePacker disponibles
     * @returns {Promise<Array>} Liste des packages
     */
    async listPackages() {
        if (!this.sessionId) {
            throw new Error('No Foundry ID available. Please connect to Beneos Cloud first.');
        }

        try {
            console.log('BeneosScenePackerManager | Fetching packages with Foundry ID:', this.sessionId);
            
            const response = await fetch(this.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    's': this.sessionId,
                    'a': 'list_packages'
                })
            });

            console.log('BeneosScenePackerManager | Response status:', response.status);
            console.log('BeneosScenePackerManager | Response ok:', response.ok);
            
            const data = await response.json();
            console.log('BeneosScenePackerManager | Response data:', data);
            
            if (data.status !== 'ok') {
                throw new Error(data.message || 'Failed to list packages');
            }

            console.log('BeneosScenePackerManager | Found packages:', data.packages.length);
            return data.packages;
            
        } catch (error) {
            console.error('BeneosScenePackerManager | Error listing packages:', error);
            throw error;
        }
    }

    /**
     * Récupère le packInfo pour un package spécifique
     * @param {string} packageId - ID du package
     * @returns {Promise<Object>} Le packInfo
     */
    async getPackInfo(packageId) {
        if (!this.sessionId) {
            throw new Error('No Foundry ID available. Please connect to Beneos Cloud first.');
        }

        try {
            console.log('BeneosScenePackerManager | Fetching packInfo for:', packageId);
            
            const response = await fetch(this.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    's': this.sessionId,
                    'a': 'get_packinfo',
                    'package': packageId
                })
            });

            const data = await response.json();
            
            if (data.status !== 'ok') {
                throw new Error(data.message || 'Failed to get packInfo');
            }

            // Ajouter le session ID à toutes les URLs du packInfo
            const packInfo = this.addSessionToUrls(data.packInfo);
            
            console.log('BeneosScenePackerManager | PackInfo retrieved with', Object.keys(packInfo).length, 'files');
            return packInfo;
            
        } catch (error) {
            console.error('BeneosScenePackerManager | Error getting packInfo:', error);
            throw error;
        }
    }

    /**
     * Ajoute le session ID à toutes les URLs du packInfo
     * @param {Object} packInfo - Le packInfo original
     * @returns {Object} Le packInfo avec session ID ajouté aux URLs
     */
    addSessionToUrls(packInfo) {
        const result = {};
        
        for (const [key, url] of Object.entries(packInfo)) {
            // Ajouter le paramètre session ID à l'URL
            const separator = url.includes('?') ? '&' : '?';
            result[key] = `${url}${separator}s=${this.sessionId}`;
        }
        
        return result;
    }

    /**
     * Importe un package ScenePacker en utilisant MoulinetteImporter
     * @param {string} packageId - ID du package à importer
     * @param {Object} options - Options d'import (sceneID, actorID, etc.)
     * @returns {Promise<void>}
     */
    async importPackage(packageId, options = {}) {
        if (!this.sessionId) {
            throw new Error('No Foundry ID available. Please connect to Beneos Cloud first.');
        }

        try {
            // Vérifier que ScenePacker est installé
            if (!game.modules.get('scene-packer')?.active) {
                throw new Error('ScenePacker module is not installed or not active');
            }

            // Récupérer le packInfo
            const packInfo = await this.getPackInfo(packageId);
            
            // Vérifier que mtte.json est présent
            if (!packInfo['mtte.json']) {
                throw new Error('Invalid package: mtte.json not found');
            }

            console.log('BeneosScenePackerManager | Launching MoulinetteImporter...');

            // Charger dynamiquement MoulinetteImporter depuis ScenePacker
            const MoulinetteImporter = (await import('/modules/scene-packer/scripts/export-import/moulinette-importer.js')).default;

            // Créer les options pour MoulinetteImporter
            const importOptions = {
                packInfo: packInfo,
                sceneID: options.sceneID || '',
                actorID: options.actorID || ''
            };

            // Créer et afficher l'importer
            const importer = new MoulinetteImporter(importOptions);
            importer.render(true);
            
            console.log('BeneosScenePackerManager | MoulinetteImporter launched successfully');
            
        } catch (error) {
            console.error('BeneosScenePackerManager | Error importing package:', error);
            ui.notifications.error(`Failed to import package: ${error.message}`);
            throw error;
        }
    }

    /**
     * Affiche un dialogue pour sélectionner et importer un package
     */
    async showPackageSelector() {
        try {
            // Récupérer la liste des packages
            const packages = await this.listPackages();
            
            if (packages.length === 0) {
                ui.notifications.info('No ScenePacker packages available');
                return;
            }

            // Construire le HTML pour le dialogue
            const packagesHtml = packages.map(pkg => `
                <div class="package-item" data-package-id="${pkg.id}">
                    <h3>${pkg.name}</h3>
                    ${pkg.cover_image ? `<img src="${this.serverUrl}/scenepacker-files.php?package=${pkg.id}&file=${pkg.cover_image}&s=${this.sessionId}" alt="${pkg.name}" style="max-width: 200px;">` : ''}
                    <p><strong>Author:</strong> ${pkg.author}</p>
                    <p><strong>Version:</strong> ${pkg.version}</p>
                    <p><strong>System:</strong> ${pkg.system}</p>
                    ${pkg.description ? `<p>${pkg.description}</p>` : ''}
                    <button class="import-package" data-package-id="${pkg.id}">Import</button>
                </div>
            `).join('<hr>');

            // Afficher le dialogue
            new Dialog({
                title: 'Beneos ScenePacker - Import Package',
                content: `
                    <div style="max-height: 600px; overflow-y: auto;">
                        ${packagesHtml}
                    </div>
                `,
                buttons: {
                    close: {
                        label: 'Close',
                        callback: () => {}
                    }
                },
                render: (html) => {
                    // Attacher les événements aux boutons d'import
                    html.find('.import-package').on('click', async (event) => {
                        const packageId = event.currentTarget.dataset.packageId;
                        try {
                            await this.importPackage(packageId);
                        } catch (error) {
                            console.error('Error importing package:', error);
                        }
                    });
                }
            }).render(true);
            
        } catch (error) {
            console.error('BeneosScenePackerManager | Error showing package selector:', error);
            ui.notifications.error('Failed to load packages');
        }
    }
}

// Instance globale
let beneosScenePackerManager = null;

// Hook d'initialisation
Hooks.once('ready', async () => {
    console.log('BeneosScenePackerManager | Module ready');
    
    // Créer l'instance globale
    const beneosScenePackerManager = new BeneosScenePackerManager();
    
    // Initialiser
    const initialized = await beneosScenePackerManager.initialize();
    
    if (initialized) {
        console.log('BeneosScenePackerManager | Ready to import packages');
        
        // Exposer dans le scope global pour accès facile
        window.BeneosScenePacker = beneosScenePackerManager;
        
        // Commande de console pour tester
        console.log('BeneosScenePackerManager | Use window.BeneosScenePacker.showPackageSelector() to import packages');
        
        // Ajouter un bouton dans l'interface Moulinette (si disponible)
        // TODO: Intégrer dans l'UI Moulinette existante
    } else {
        console.warn('BeneosScenePackerManager | Not initialized - authentication required');
    }
});
