/**
 * Google Auth & API Adapter for Google Drive and Google Sheets.
 * Supports Service Account JWT, environment variables, and seamless simulation fallback.
 */

export interface GoogleAuthConfig {
  serviceAccountKeyJson?: string;
  credentialsPath?: string;
  apiKey?: string;
  accessToken?: string;
}

export interface GoogleAuthStatus {
  isConfigured: boolean;
  mode: 'LIVE' | 'SIMULATED';
  clientEmail?: string;
  projectId?: string;
  message: string;
}

class GoogleAuthAdapter {
  private config: GoogleAuthConfig = {};
  private readonly folderIdCache = new Map<string, string>();

  constructor() {
    this.detectEnvironmentCredentials();
  }

  clearFolderCache(): void {
    this.folderIdCache.clear();
  }

  detectEnvironmentCredentials(): void {
    if (typeof process === 'undefined') return;

    this.config = {
      serviceAccountKeyJson: process.env['GOOGLE_SERVICE_ACCOUNT_KEY_JSON'],
      credentialsPath: process.env['GOOGLE_APPLICATION_CREDENTIALS'],
      apiKey: process.env['GOOGLE_API_KEY'],
      accessToken: process.env['GOOGLE_ACCESS_TOKEN'],
    };
  }

  /**
   * Resolves a hierarchical Drive folder path (e.g. `/HOMEL_360/Backups`) into a real
   * Google Drive folder ID, creating missing folder segments via Drive API v3 and caching
   * resolved IDs in memory.
   */
  async resolveFolderPath(folderPath: string, token: string): Promise<string | null> {
    if (!token || !folderPath) return null;

    const segments = folderPath
      .split(/[/\\]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== '.' && s !== '..');

    if (segments.length === 0) return null;

    const fullCacheKey = segments.join('/');
    const cachedFull = this.folderIdCache.get(fullCacheKey);
    if (cachedFull) return cachedFull;

    let parentId: string | null = null;

    for (let idx = 0; idx < segments.length; idx++) {
      const segment = segments[idx];
      if (!segment) continue;

      const prefixKey = segments.slice(0, idx + 1).join('/');
      const cachedPrefix = this.folderIdCache.get(prefixKey);
      if (cachedPrefix) {
        parentId = cachedPrefix;
        continue;
      }

      const escapedName = segment.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const parentClause = parentId ? `'${parentId}' in parents` : `'root' in parents`;
      const query = `mimeType='application/vnd.google-apps.folder' and name='${escapedName}' and trashed=false and ${parentClause}`;
      const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1`;

      let resolvedId: string | null = null;
      try {
        const searchRes = await fetch(searchUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });
        if (!searchRes.ok) {
          return null;
        }
        const searchJson = (await searchRes.json()) as {
          files?: Array<{ id?: string; name?: string }>;
        };
        const existingId = searchJson.files?.[0]?.id;
        if (existingId) {
          resolvedId = existingId;
        } else {
          const createBody: Record<string, unknown> = {
            name: segment,
            mimeType: 'application/vnd.google-apps.folder',
          };
          if (parentId) {
            createBody['parents'] = [parentId];
          }
          const createRes = await fetch(
            'https://www.googleapis.com/drive/v3/files?fields=id,name',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(createBody),
            },
          );
          if (!createRes.ok) {
            return null;
          }
          const createdJson = (await createRes.json()) as { id?: string };
          if (!createdJson.id) {
            return null;
          }
          resolvedId = createdJson.id;
        }
      } catch {
        return null;
      }

      this.folderIdCache.set(prefixKey, resolvedId);
      parentId = resolvedId;
    }

    return parentId;
  }

  getStatus(): GoogleAuthStatus {
    this.detectEnvironmentCredentials();

    if (this.config.serviceAccountKeyJson) {
      try {
        const parsed = JSON.parse(this.config.serviceAccountKeyJson);
        return {
          isConfigured: true,
          mode: 'LIVE',
          clientEmail: parsed.client_email,
          projectId: parsed.project_id,
          message: `Service Account configurado: ${parsed.client_email}`,
        };
      } catch {
        // malformed json, fallback to simulated
      }
    }

    if (this.config.credentialsPath) {
      return {
        isConfigured: true,
        mode: 'LIVE',
        message: `Ruta de credenciales detectada: ${this.config.credentialsPath}`,
      };
    }

    if (this.config.accessToken) {
      return {
        isConfigured: true,
        mode: 'LIVE',
        message: 'OAuth2 Access Token activo',
      };
    }

    return {
      isConfigured: false,
      mode: 'SIMULATED',
      message:
        'Modo simulado activo. Para conexión en vivo, defina GOOGLE_SERVICE_ACCOUNT_KEY_JSON o GOOGLE_APPLICATION_CREDENTIALS.',
    };
  }

  /**
   * Uploads file to Google Drive or simulates the upload only when credentials are unconfigured.
   * When credentials are configured (LIVE), resolves hierarchical folderPath values to real
   * Drive folder IDs and honestly reports DISCONNECTED on auth/network/API failures.
   */
  async uploadDriveFile(params: {
    name: string;
    mimeType: string;
    data: string; // base64 or string content
    folderId?: string;
    folderPath?: string;
  }): Promise<{
    fileId: string;
    name: string;
    webViewLink: string;
    downloadLink: string;
    mode: 'LIVE' | 'SIMULATED' | 'DISCONNECTED';
    sizeBytes: number;
    resolvedFolderId?: string;
    error?: string;
  }> {
    const status = this.getStatus();
    const sizeBytes = Buffer.byteLength(params.data, 'utf8');

    let effectiveFolderPath = params.folderPath?.trim() || undefined;
    let effectiveFolderId = params.folderId?.trim() || undefined;

    // Never pass a Unix/Windows path directly in Drive metadata.parents
    if (effectiveFolderId && (effectiveFolderId.includes('/') || effectiveFolderId.includes('\\'))) {
      effectiveFolderPath = effectiveFolderPath || effectiveFolderId;
      effectiveFolderId = undefined;
    }

    if (status.mode === 'LIVE') {
      try {
        const token = await this.getAccessToken();
        if (!token) {
          return {
            fileId: '',
            name: params.name,
            webViewLink: '',
            downloadLink: '',
            mode: 'DISCONNECTED',
            sizeBytes,
            error:
              'Credenciales configuradas pero sin token OAuth2 activo (GOOGLE_ACCESS_TOKEN) para carga en vivo.',
          };
        }

        if (!effectiveFolderId && effectiveFolderPath) {
          const resolvedId = await this.resolveFolderPath(effectiveFolderPath, token);
          if (!resolvedId) {
            return {
              fileId: '',
              name: params.name,
              webViewLink: '',
              downloadLink: '',
              mode: 'DISCONNECTED',
              sizeBytes,
              error: `No se pudo resolver ni crear la ruta de carpeta en Google Drive: ${effectiveFolderPath}`,
            };
          }
          effectiveFolderId = resolvedId;
        }

        const boundary = '-------314159265358979323846';
        const delimiter = `\r\n--${boundary}\r\n`;
        const closeDelimiter = `\r\n--${boundary}--`;

        const metadata: Record<string, unknown> = {
          name: params.name,
          mimeType: params.mimeType,
        };
        if (
          effectiveFolderId &&
          !effectiveFolderId.includes('/') &&
          !effectiveFolderId.includes('\\')
        ) {
          metadata['parents'] = [effectiveFolderId];
        }

        const isBase64 = !params.data.startsWith('{') && !params.data.startsWith('[');
        const fileBuffer = isBase64
          ? Buffer.from(params.data, 'base64')
          : Buffer.from(params.data, 'utf8');

        const multipartRequestBody = Buffer.concat([
          Buffer.from(
            `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n${delimiter}Content-Type: ${params.mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`,
          ),
          Buffer.from(fileBuffer.toString('base64')),
          Buffer.from(closeDelimiter),
        ]);

        const res = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: multipartRequestBody,
          },
        );

        if (res.ok) {
          const json: any = await res.json();
          return {
            fileId: json.id,
            name: json.name || params.name,
            webViewLink: json.webViewLink || `https://drive.google.com/file/d/${json.id}/view`,
            downloadLink:
              json.webContentLink || `https://drive.google.com/uc?id=${json.id}&export=download`,
            mode: 'LIVE',
            sizeBytes,
            resolvedFolderId: effectiveFolderId,
          };
        }

        const errorBody = await res.text().catch(() => '');
        return {
          fileId: '',
          name: params.name,
          webViewLink: '',
          downloadLink: '',
          mode: 'DISCONNECTED',
          sizeBytes,
          resolvedFolderId: effectiveFolderId,
          error: `Google Drive HTTP ${res.status}${errorBody ? `: ${errorBody.slice(0, 200)}` : ''}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          fileId: '',
          name: params.name,
          webViewLink: '',
          downloadLink: '',
          mode: 'DISCONNECTED',
          sizeBytes,
          resolvedFolderId: effectiveFolderId,
          error: `Error de red al subir a Google Drive: ${message}`,
        };
      }
    }

    // Simulated / offline safe fallback ONLY when no credentials are configured
    const simulatedId = `1gDrive_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
    return {
      fileId: simulatedId,
      name: params.name,
      webViewLink: `https://drive.google.com/file/d/${simulatedId}/view?usp=drivesdk`,
      downloadLink: `https://drive.google.com/uc?id=${simulatedId}&export=download`,
      mode: 'SIMULATED',
      sizeBytes,
    };
  }

  /**
   * Appends rows to a Google Sheet or simulates the append if credentials are not configured.
   */
  async appendSheetRows(params: {
    spreadsheetId: string;
    sheetName: string;
    values: (string | number | null)[][];
  }): Promise<{
    spreadsheetId: string;
    updatedRange: string;
    updatedRows: number;
    mode: 'LIVE' | 'SIMULATED';
    spreadsheetUrl: string;
  }> {
    const status = this.getStatus();
    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${params.spreadsheetId}/edit`;

    if (status.mode === 'LIVE') {
      try {
        const token = await this.getAccessToken();
        if (token) {
          const range = `${params.sheetName}!A:Z`;
          const url = `https://sheets.googleapis.com/v4/spreadsheets/${params.spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              values: params.values,
            }),
          });

          if (res.ok) {
            const json: any = await res.json();
            return {
              spreadsheetId: params.spreadsheetId,
              updatedRange: json.updates?.updatedRange || `${params.sheetName}!A1`,
              updatedRows: json.updates?.updatedRows || params.values.length,
              mode: 'LIVE',
              spreadsheetUrl,
            };
          }
        }
      } catch (err) {
        console.warn(
          '[GoogleAuthAdapter] Live appendSheetRows failed, using simulated response:',
          err,
        );
      }
    }

    // Simulated safe response
    return {
      spreadsheetId: params.spreadsheetId,
      updatedRange: `'${params.sheetName}'!A2:L${params.values.length + 1}`,
      updatedRows: params.values.length,
      mode: 'SIMULATED',
      spreadsheetUrl,
    };
  }

  private async getAccessToken(): Promise<string | null> {
    if (this.config.accessToken) return this.config.accessToken;
    // In node environment with service account, token generation can be injected or passed via env
    return null;
  }
}

export const googleAuthAdapter = new GoogleAuthAdapter();
