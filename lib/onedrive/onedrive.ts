/**
 * OneDrive Service
 * Handles all interactions with Microsoft Graph API for OneDrive operations
 * Uses Application-Only (Client Credentials) authentication
 */

import { Buffer } from "node:buffer"

import type {
  OneDriveItem,
  OneDriveFolderResponse,
  OneDriveUploadResult,
  AzureTokenResponse,
  OneDriveDrive,
  OneDriveDriveResponse,
  OneDriveConfig,
  FileItem,
  FileCategory,
} from "./types"

let cachedToken: { token: string; expiresAt: number } | null = null
let cachedResolvedSiteId: string | null = null
let cachedSiteDrives: OneDriveDrive[] | null = null
const cachedDriveBaseUrls = new Map<string, string>()
const RETRYABLE_GRAPH_STATUSES = new Set([500, 502, 503, 504])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRetryGraphError(status: number, errorText: string): boolean {
  if (!RETRYABLE_GRAPH_STATUSES.has(status)) return false

  const normalizedErrorText = errorText.toLowerCase()
  return (
    normalizedErrorText.includes("generalexception") ||
    normalizedErrorText.includes("timeout") ||
    normalizedErrorText.includes("temporar") ||
    normalizedErrorText.includes("try again")
  )
}

function normalizeGraphPath(path: string): string {
  const normalized = `/${path || ""}`.replace(/\/+/g, "/")
  return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized
}

function buildChildrenEndpoint(relativePath: string): string {
  const normalizedRelativePath = normalizeGraphPath(relativePath)
  if (normalizedRelativePath === "/" || normalizedRelativePath === "") {
    return "/root/children"
  }

  const encodedPath = encodeURIComponent(normalizedRelativePath.replace(/^\//, ""))
  return `/root:/${encodedPath}:/children`
}

function buildSharingToken(webUrl: string): string {
  const base64 = Buffer.from(webUrl, "utf-8").toString("base64")
  return `u!${base64.replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-")}`
}

function buildItemEndpoint(relativePath: string, suffix = ""): string {
  const normalizedRelativePath = normalizeGraphPath(relativePath)
  const encodedPath = encodeURIComponent(normalizedRelativePath.replace(/^\//, ""))
  return `/root:/${encodedPath}${suffix}`
}

function extractRelativeParentPath(parentReferencePath?: string): string {
  if (!parentReferencePath) return "/"

  const rootMarkerIndex = parentReferencePath.indexOf("root:")
  if (rootMarkerIndex === -1) {
    return "/"
  }

  const afterRoot = parentReferencePath.slice(rootMarkerIndex + "root:".length)
  return normalizeGraphPath(afterRoot || "/")
}

function getActorDisplayName(item?: OneDriveItem["createdBy"]): string | undefined {
  return item?.user?.displayName || item?.application?.displayName || item?.device?.displayName
}

type PathTarget =
  | {
      mode: "site-library-root"
    }
  | {
      mode: "drive"
      baseUrl: string
      libraryName?: string
      relativePath: string
    }

export class OneDriveService {
  private config: OneDriveConfig

  constructor() {
    this.config = {
      tenantId: process.env.AZURE_TENANT_ID || "",
      clientId: process.env.AZURE_CLIENT_ID || "",
      clientSecret: process.env.AZURE_CLIENT_SECRET || "",
      userEmail: process.env.ONEDRIVE_USER_EMAIL || "",
      siteId: process.env.ONEDRIVE_SITE_ID || "",
      siteHostname: process.env.ONEDRIVE_SITE_HOSTNAME || "",
      sitePath: process.env.ONEDRIVE_SITE_PATH || "",
      driveId: process.env.ONEDRIVE_DRIVE_ID || "",
      driveName: process.env.ONEDRIVE_DRIVE_NAME || "",
      paymentsFolder: process.env.ONEDRIVE_PAYMENTS_FOLDER || "/Payments",
      projectsFolder: process.env.ONEDRIVE_PROJECTS_FOLDER || "/Projects",
    }
  }

  isEnabled(): boolean {
    const hasLegacyUserTarget = !!this.config.userEmail
    const hasModernSiteTarget =
      !!this.config.driveId || !!this.config.siteId || (!!this.config.siteHostname && !!this.config.sitePath)

    return (
      process.env.ONEDRIVE_ENABLED === "true" &&
      !!this.config.tenantId &&
      !!this.config.clientId &&
      !!this.config.clientSecret &&
      (hasLegacyUserTarget || hasModernSiteTarget)
    )
  }

  private isSiteMode(): boolean {
    return !!this.config.driveId || !!this.config.siteId || (!!this.config.siteHostname && !!this.config.sitePath)
  }

  private isMultiLibraryMode(): boolean {
    return this.isSiteMode() && !this.config.driveId && !this.config.driveName
  }

  private async getAccessToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
      return cachedToken.token
    }

    const tokenUrl = `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    })

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to get access token: ${error}`)
    }

    const data: AzureTokenResponse = await response.json()
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    }

    return data.access_token
  }

  private async graphApiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      })

      if (response.ok) {
        if (response.status === 204) {
          return {} as T
        }

        return response.json()
      }

      const error = await response.text()
      if (attempt === 0 && shouldRetryGraphError(response.status, error)) {
        await sleep(500)
        continue
      }

      throw new Error(`Graph API error (${response.status}): ${error}`)
    }

    throw new Error("Graph API request failed after retry")
  }

  private async driveRequest<T>(baseUrl: string, endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      })

      if (response.ok) {
        if (response.status === 204) {
          return {} as T
        }

        return response.json()
      }

      const error = await response.text()
      if (attempt === 0 && shouldRetryGraphError(response.status, error)) {
        await sleep(500)
        continue
      }

      throw new Error(`Graph API error (${response.status}): ${error}`)
    }

    throw new Error("Graph API request failed after retry")
  }

  private async resolveSiteId(): Promise<string> {
    if (this.config.siteId) {
      return this.config.siteId
    }

    if (cachedResolvedSiteId) {
      return cachedResolvedSiteId
    }

    if (!this.config.siteHostname || !this.config.sitePath) {
      throw new Error("OneDrive site configuration is incomplete")
    }

    const normalizedSitePath = normalizeGraphPath(this.config.sitePath)
    const response = await this.graphApiRequest<{ id: string }>(
      `/sites/${this.config.siteHostname}:${normalizedSitePath}`
    )

    cachedResolvedSiteId = response.id
    return response.id
  }

  private async getSiteDrives(): Promise<OneDriveDrive[]> {
    if (cachedSiteDrives) {
      return cachedSiteDrives
    }

    const siteId = await this.resolveSiteId()
    const drives = await this.graphApiRequest<OneDriveDriveResponse>(`/sites/${siteId}/drives`)
    cachedSiteDrives = drives.value
    return drives.value
  }

  private async resolveSingleDriveBaseUrl(): Promise<string> {
    if (cachedDriveBaseUrls.has("__single__")) {
      return cachedDriveBaseUrls.get("__single__")!
    }

    let baseUrl = ""

    if (this.config.driveId) {
      baseUrl = `https://graph.microsoft.com/v1.0/drives/${this.config.driveId}`
    } else if (this.isSiteMode()) {
      const drives = await this.getSiteDrives()
      const matchingDrive =
        (this.config.driveName
          ? drives.find((drive) => drive.name.toLowerCase() === this.config.driveName.toLowerCase())
          : undefined) ||
        drives.find((drive) => drive.name.toLowerCase() === "documents") ||
        drives[0]

      if (!matchingDrive) {
        throw new Error("No OneDrive document library was found for the configured site")
      }

      baseUrl = `https://graph.microsoft.com/v1.0/drives/${matchingDrive.id}`
    } else if (this.config.userEmail) {
      baseUrl = `https://graph.microsoft.com/v1.0/users/${this.config.userEmail}/drive`
    } else {
      throw new Error("OneDrive target is not configured")
    }

    cachedDriveBaseUrls.set("__single__", baseUrl)
    return baseUrl
  }

  private async resolveDriveBaseUrlForLibrary(libraryName: string): Promise<string> {
    const cacheKey = libraryName.toLowerCase()
    if (cachedDriveBaseUrls.has(cacheKey)) {
      return cachedDriveBaseUrls.get(cacheKey)!
    }

    const drives = await this.getSiteDrives()
    const matchingDrive = drives.find((drive) => drive.name.toLowerCase() === libraryName.toLowerCase())

    if (!matchingDrive) {
      throw new Error(`Document library "${libraryName}" was not found`)
    }

    const baseUrl = `https://graph.microsoft.com/v1.0/drives/${matchingDrive.id}`
    cachedDriveBaseUrls.set(cacheKey, baseUrl)
    return baseUrl
  }

  private async resolvePathTarget(path: string): Promise<PathTarget> {
    const normalizedPath = normalizeGraphPath(path)

    if (this.isMultiLibraryMode()) {
      if (normalizedPath === "/") {
        return { mode: "site-library-root" }
      }

      const [, libraryName, ...rest] = normalizedPath.split("/")
      if (!libraryName) {
        return { mode: "site-library-root" }
      }

      return {
        mode: "drive",
        baseUrl: await this.resolveDriveBaseUrlForLibrary(libraryName),
        libraryName,
        relativePath: rest.length > 0 ? `/${rest.join("/")}` : "/",
      }
    }

    return {
      mode: "drive",
      baseUrl: await this.resolveSingleDriveBaseUrl(),
      relativePath: normalizedPath,
    }
  }

  private async listLibraries(): Promise<FileItem[]> {
    const drives = await this.getSiteDrives()

    return drives.map((drive) => ({
      id: drive.id,
      name: drive.name,
      path: normalizeGraphPath(`/${drive.name}`),
      size: 0,
      isFolder: true,
      createdAt: undefined,
      lastModified: "",
      createdBy: undefined,
      lastModifiedBy: undefined,
      webUrl: drive.webUrl || "",
      childCount: undefined,
    }))
  }

  private transformItem(item: OneDriveItem, parentPath: string): FileItem {
    const isFolder = !!item.folder
    const path = normalizeGraphPath(`${parentPath}/${item.name}`)

    return {
      id: item.id,
      name: item.name,
      path,
      size: item.size,
      isFolder,
      mimeType: item.file?.mimeType,
      createdAt: item.createdDateTime,
      lastModified: item.lastModifiedDateTime,
      createdBy: getActorDisplayName(item.createdBy),
      lastModifiedBy: getActorDisplayName(item.lastModifiedBy),
      webUrl: item.webUrl,
      downloadUrl: item["@microsoft.graph.downloadUrl"],
      childCount: item.folder?.childCount,
    }
  }

  private transformSearchItem(item: OneDriveItem, libraryName?: string): FileItem {
    const relativeParentPath = extractRelativeParentPath(item.parentReference?.path)
    const parentPath = libraryName ? normalizeGraphPath(`/${libraryName}${relativeParentPath}`) : relativeParentPath
    return this.transformItem(item, parentPath)
  }

  async listFolder(folderPath: string): Promise<FileItem[]> {
    const target = await this.resolvePathTarget(folderPath)

    if (target.mode === "site-library-root") {
      return this.listLibraries()
    }

    const response = await this.driveRequest<OneDriveFolderResponse>(
      target.baseUrl,
      buildChildrenEndpoint(target.relativePath)
    )

    const parentPath = target.libraryName
      ? normalizeGraphPath(`/${target.libraryName}${target.relativePath === "/" ? "" : target.relativePath}`)
      : normalizeGraphPath(folderPath)

    return response.value.map((item) => this.transformItem(item, parentPath))
  }

  async getItem(itemPath: string): Promise<FileItem> {
    const target = await this.resolvePathTarget(itemPath)
    if (target.mode === "site-library-root") {
      throw new Error("A document library must be selected")
    }

    const item = await this.driveRequest<OneDriveItem>(target.baseUrl, buildItemEndpoint(target.relativePath))
    const parentPath = target.libraryName
      ? normalizeGraphPath(`/${target.libraryName}${extractRelativeParentPath(item.parentReference?.path)}`)
      : extractRelativeParentPath(item.parentReference?.path)

    return this.transformItem(item, parentPath)
  }

  async uploadFile(
    filePath: string,
    content: Uint8Array | ArrayBuffer,
    mimeType?: string
  ): Promise<OneDriveUploadResult> {
    const target = await this.resolvePathTarget(filePath)
    if (target.mode === "site-library-root") {
      throw new Error("A document library must be selected")
    }

    const token = await this.getAccessToken()
    const response = await fetch(`${target.baseUrl}${buildItemEndpoint(target.relativePath, ":/content")}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": mimeType || "application/octet-stream",
      },
      body: (content instanceof ArrayBuffer ? new Uint8Array(content) : content) as BodyInit,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to upload file: ${error}`)
    }

    return response.json()
  }

  async createFolder(folderPath: string): Promise<OneDriveItem> {
    const target = await this.resolvePathTarget(folderPath)
    if (target.mode === "site-library-root") {
      throw new Error("A document library must be selected")
    }

    const pathParts = target.relativePath.replace(/^\//, "").split("/").filter(Boolean)
    let currentPath = ""
    let lastItem: OneDriveItem | null = null

    for (const part of pathParts) {
      const endpoint = buildChildrenEndpoint(currentPath || "/")

      try {
        lastItem = await this.driveRequest<OneDriveItem>(target.baseUrl, endpoint, {
          method: "POST",
          body: JSON.stringify({
            name: part,
            folder: {},
            "@microsoft.graph.conflictBehavior": "replace",
          }),
        })
      } catch (error: unknown) {
        if (!(error instanceof Error) || !error.message.includes("nameAlreadyExists")) {
          throw error
        }
      }

      currentPath = currentPath ? `${currentPath}/${part}` : part
    }

    return lastItem!
  }

  async deleteItem(itemPath: string): Promise<void> {
    const target = await this.resolvePathTarget(itemPath)
    if (target.mode === "site-library-root") {
      throw new Error("A document library must be selected")
    }

    await this.driveRequest(target.baseUrl, buildItemEndpoint(target.relativePath), { method: "DELETE" })
  }

  async renameItem(itemPath: string, newName: string): Promise<OneDriveItem> {
    const target = await this.resolvePathTarget(itemPath)
    if (target.mode === "site-library-root") {
      throw new Error("A document library must be selected")
    }

    return this.driveRequest<OneDriveItem>(target.baseUrl, buildItemEndpoint(target.relativePath), {
      method: "PATCH",
      body: JSON.stringify({ name: newName }),
    })
  }

  async moveItem(itemPath: string, destinationFolderPath: string, newName?: string): Promise<OneDriveItem> {
    const sourceTarget = await this.resolvePathTarget(itemPath)
    const destinationTarget = await this.resolvePathTarget(destinationFolderPath)

    if (sourceTarget.mode === "site-library-root" || destinationTarget.mode === "site-library-root") {
      throw new Error("A document library must be selected")
    }

    if (sourceTarget.baseUrl !== destinationTarget.baseUrl) {
      throw new Error("Moving items across different document libraries is not supported")
    }

    const destinationFolder = await this.driveRequest<OneDriveItem>(
      destinationTarget.baseUrl,
      buildItemEndpoint(destinationTarget.relativePath)
    )

    return this.driveRequest<OneDriveItem>(sourceTarget.baseUrl, buildItemEndpoint(sourceTarget.relativePath), {
      method: "PATCH",
      body: JSON.stringify({
        name: newName,
        parentReference: {
          id: destinationFolder.id,
        },
      }),
    })
  }

  async getDownloadUrl(filePath: string): Promise<string> {
    const target = await this.resolvePathTarget(filePath)
    if (target.mode === "site-library-root") {
      throw new Error("A document library must be selected")
    }

    const item = await this.driveRequest<OneDriveItem>(
      target.baseUrl,
      `${buildItemEndpoint(target.relativePath)}?select=@microsoft.graph.downloadUrl`
    )

    if (!item["@microsoft.graph.downloadUrl"]) {
      throw new Error("Download URL not available")
    }

    return item["@microsoft.graph.downloadUrl"]
  }

  /**
   * Resolves an item from its SharePoint/OneDrive web URL (the `webUrl` returned at
   * upload time) via the Graph `/shares` endpoint. Used to stream files that were
   * stored with only their web URL recorded.
   */
  async getItemByWebUrl(webUrl: string): Promise<OneDriveItem> {
    return this.graphApiRequest<OneDriveItem>(
      `/shares/${buildSharingToken(webUrl)}/driveItem?select=id,name,size,file,webUrl,@microsoft.graph.downloadUrl`
    )
  }

  async getDownloadUrlByWebUrl(webUrl: string): Promise<string> {
    const item = await this.getItemByWebUrl(webUrl)
    if (!item["@microsoft.graph.downloadUrl"]) {
      throw new Error("Download URL not available")
    }

    return item["@microsoft.graph.downloadUrl"]
  }

  async getPreviewUrl(filePath: string): Promise<string> {
    const target = await this.resolvePathTarget(filePath)
    if (target.mode === "site-library-root") {
      throw new Error("A document library must be selected")
    }

    const response = await this.driveRequest<{ getUrl: string }>(
      target.baseUrl,
      `${buildItemEndpoint(target.relativePath)}/preview`,
      { method: "POST" }
    )

    return response.getUrl
  }

  async searchFiles(query: string, folderPath?: string): Promise<FileItem[]> {
    const searchQuery = encodeURIComponent(query)
    const normalizedFolderPath = normalizeGraphPath(folderPath || "/")

    if (this.isMultiLibraryMode()) {
      const target = await this.resolvePathTarget(normalizedFolderPath)

      if (target.mode === "drive") {
        const response = await this.driveRequest<OneDriveFolderResponse>(
          target.baseUrl,
          `/root/search(q='${searchQuery}')`
        )

        const scopedResults = response.value.map((item) => this.transformSearchItem(item, target.libraryName))
        return scopedResults.filter(
          (item) => item.path === normalizedFolderPath || item.path.startsWith(`${normalizedFolderPath}/`)
        )
      }

      const drives = await this.getSiteDrives()
      const results = await Promise.all(
        drives.map(async (drive) => {
          const baseUrl = await this.resolveDriveBaseUrlForLibrary(drive.name)
          const response = await this.driveRequest<OneDriveFolderResponse>(baseUrl, `/root/search(q='${searchQuery}')`)
          return response.value.map((item) => this.transformSearchItem(item, drive.name))
        })
      )

      return results.flat()
    }

    const baseUrl = await this.resolveSingleDriveBaseUrl()
    const response = await this.driveRequest<OneDriveFolderResponse>(baseUrl, `/root/search(q='${searchQuery}')`)
    const items = response.value.map((item) => this.transformSearchItem(item))

    if (folderPath) {
      return items.filter(
        (item) => item.path === normalizedFolderPath || item.path.startsWith(`${normalizedFolderPath}/`)
      )
    }

    return items
  }

  getPaymentsPath(departmentName: string, paymentId: string, fileName?: string): string {
    const basePath = `${this.config.paymentsFolder}/${departmentName}/${paymentId}`
    return fileName ? `${basePath}/${fileName}` : basePath
  }

  getProjectsPath(): string {
    return this.config.projectsFolder
  }
}

export function getFileCategory(mimeType?: string, fileName?: string): FileCategory {
  if (!mimeType && !fileName) return "unknown"

  if (mimeType) {
    if (mimeType.startsWith("image/")) return "image"
    if (mimeType.startsWith("video/")) return "video"
    if (mimeType.startsWith("audio/")) return "audio"
    if (mimeType === "application/pdf") return "pdf"
    if (
      mimeType.includes("spreadsheet") ||
      mimeType.includes("excel") ||
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) {
      return "spreadsheet"
    }
    if (
      mimeType.includes("presentation") ||
      mimeType.includes("powerpoint") ||
      mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ) {
      return "presentation"
    }
    if (
      mimeType.includes("document") ||
      mimeType.includes("word") ||
      mimeType === "application/msword" ||
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      return "document"
    }
    if (mimeType.includes("zip") || mimeType.includes("compressed")) return "archive"
    if (
      mimeType.includes("javascript") ||
      mimeType.includes("json") ||
      mimeType.includes("xml") ||
      mimeType.includes("html")
    ) {
      return "code"
    }
  }

  if (fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase()
    switch (ext) {
      case "jpg":
      case "jpeg":
      case "png":
      case "gif":
      case "webp":
      case "svg":
      case "bmp":
        return "image"
      case "mp4":
      case "mov":
      case "avi":
      case "mkv":
      case "webm":
        return "video"
      case "mp3":
      case "wav":
      case "ogg":
      case "flac":
        return "audio"
      case "pdf":
        return "pdf"
      case "doc":
      case "docx":
      case "odt":
      case "rtf":
        return "document"
      case "xls":
      case "xlsx":
      case "ods":
      case "csv":
        return "spreadsheet"
      case "ppt":
      case "pptx":
      case "odp":
        return "presentation"
      case "zip":
      case "rar":
      case "7z":
      case "tar":
      case "gz":
        return "archive"
      case "js":
      case "ts":
      case "jsx":
      case "tsx":
      case "py":
      case "java":
      case "css":
      case "html":
      case "json":
      case "xml":
        return "code"
    }
  }

  return "unknown"
}

let oneDriveInstance: OneDriveService | null = null

export function getOneDriveService(): OneDriveService {
  if (!oneDriveInstance) {
    oneDriveInstance = new OneDriveService()
  }
  return oneDriveInstance
}
