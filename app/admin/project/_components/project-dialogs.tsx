"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import type { Project } from "./project-admin-content"
import { apiFetch } from "@/lib/api-client"

interface ProjectDialogsProps {
  profiles: Array<{
    id: string
    first_name: string
    last_name: string
    full_name?: string | null
    department: string
  }>
  isAddOpen: boolean
  setIsAddOpen: (open: boolean) => void
  isEditOpen: boolean
  setIsEditOpen: (open: boolean) => void
  selectedProject: Project | null
  onSuccess: () => void
}

export function ProjectDialogs({
  profiles,
  isAddOpen,
  setIsAddOpen,
  isEditOpen,
  setIsEditOpen,
  selectedProject,
  onSuccess,
}: ProjectDialogsProps) {
  const [loading, setLoading] = useState(false)

  // Form states
  const [projectName, setProjectName] = useState("")
  const [location, setLocation] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [capacity, setCapacity] = useState("")
  const [techType, setTechType] = useState("")
  const [managerId, setManagerId] = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState<"planning" | "active" | "on_hold" | "completed" | "cancelled">("planning")
  const [portfolioId, setPortfolioId] = useState("")
  const [portfolios, setPortfolios] = useState<Array<{ id: string; name: string; code: string | null }>>([])

  // A project may sit outside every portfolio, so a failed load must not block
  // the form — it just leaves the selector empty.
  useEffect(() => {
    if (!isAddOpen && !isEditOpen) return
    apiFetch("/api/portfolios", { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) =>
        setPortfolios(
          (payload.data ?? []).map((portfolio: { id: string; name: string; code: string | null }) => ({
            id: portfolio.id,
            name: portfolio.name,
            code: portfolio.code,
          }))
        )
      )
      .catch(() => setPortfolios([]))
  }, [isAddOpen, isEditOpen])

  // Sync form states with selected project for editing
  useEffect(() => {
    if (selectedProject && isEditOpen) {
      setProjectName(selectedProject.project_name)
      setLocation(selectedProject.location)
      setStartDate(selectedProject.deployment_start_date)
      setEndDate(selectedProject.deployment_end_date)
      setCapacity(selectedProject.capacity_w ? String(selectedProject.capacity_w) : "")
      setTechType(selectedProject.technology_type || "")
      setManagerId(selectedProject.project_manager_id || "")
      setDescription(selectedProject.description || "")
      setStatus(selectedProject.status)
      setPortfolioId(selectedProject.portfolio_id || "")
    } else {
      // Reset for add
      setProjectName("")
      setLocation("")
      setStartDate("")
      setEndDate("")
      setCapacity("")
      setTechType("")
      setManagerId("")
      setDescription("")
      setStatus("planning")
      setPortfolioId("")
    }
  }, [selectedProject, isEditOpen])

  // Handle Add Project submit
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectName || !location || !startDate || !endDate) {
      toast.error("Please fill in all required fields")
      return
    }

    setLoading(true)
    try {
      const res = await apiFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_name: projectName,
          location,
          deployment_start_date: startDate,
          deployment_end_date: endDate,
          capacity_w: capacity ? Number(capacity) : null,
          technology_type: techType || null,
          project_manager_id: managerId || null,
          description: description || null,
          status,
          portfolio_id: portfolioId || null,
        }),
      })

      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to create project")

      toast.success("Project created successfully!")
      setIsAddOpen(false)
      onSuccess()
    } catch (err: any) {
      toast.error(err.message || "An error occurred while creating project")
    } finally {
      setLoading(false)
    }
  }

  // Handle Edit Project submit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProject) return

    if (!projectName || !location || !startDate || !endDate) {
      toast.error("Please fill in all required fields")
      return
    }

    setLoading(true)
    try {
      const res = await apiFetch(`/api/projects/${selectedProject.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_name: projectName,
          location,
          deployment_start_date: startDate,
          deployment_end_date: endDate,
          capacity_w: capacity ? Number(capacity) : null,
          technology_type: techType || null,
          project_manager_id: managerId || null,
          description: description || null,
          status,
          portfolio_id: portfolioId || null,
        }),
      })

      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to update project")

      toast.success("Project updated successfully!")
      setIsEditOpen(false)
      onSuccess()
    } catch (err: any) {
      toast.error(err.message || "An error occurred while updating project")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* ADD PROJECT DIALOG */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add Project Profile</DialogTitle>
            <DialogDescription>Create a new ongoing project deployment record.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddSubmit} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="add-name" className="text-xs font-semibold">
                Project Title <span className="text-red-500">*</span>
              </Label>
              <Input
                id="add-name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. 1155KWp INTERCONNECTED MINI-GRID"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="add-location" className="text-xs font-semibold">
                  Site Location <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="add-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="City, State"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-tech" className="text-xs font-semibold">
                  Technology Type
                </Label>
                <Input
                  id="add-tech"
                  value={techType}
                  onChange={(e) => setTechType(e.target.value)}
                  placeholder="e.g. Interconnected Mini-Grid"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="add-capacity" className="text-xs font-semibold">
                  Power Capacity (Watts)
                </Label>
                <Input
                  id="add-capacity"
                  type="number"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="e.g. 1155000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-portfolio" className="text-xs font-semibold">
                  Portfolio
                </Label>
                <select
                  id="add-portfolio"
                  value={portfolioId}
                  onChange={(e) => setPortfolioId(e.target.value)}
                  className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
                >
                  <option value="">No portfolio</option>
                  {portfolios.map((portfolio) => (
                    <option key={portfolio.id} value={portfolio.id}>
                      {portfolio.code ? `${portfolio.code} — ${portfolio.name}` : portfolio.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-manager" className="text-xs font-semibold">
                  Project Manager
                </Label>
                <select
                  id="add-manager"
                  value={managerId}
                  onChange={(e) => setManagerId(e.target.value)}
                  className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
                >
                  <option value="">Unassigned</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name || `${p.first_name} ${p.last_name}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="add-start" className="text-xs font-semibold">
                  Start Date <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="add-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-end" className="text-xs font-semibold">
                  Target End Date <span className="text-red-500">*</span>
                </Label>
                <Input id="add-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="add-status" className="text-xs font-semibold">
                Project Status
              </Label>
              <select
                id="add-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
              >
                <option value="planning">Planning</option>
                <option value="active">Ongoing (Active)</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="add-desc" className="text-xs font-semibold">
                Project Description
              </Label>
              <Textarea
                id="add-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Details of project scope, timelines, etc."
                rows={3}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Creating..." : "Create Project"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT PROJECT DIALOG */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Project Profile</DialogTitle>
            <DialogDescription>Modify fields and overall status of the deployment profile.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-name" className="text-xs font-semibold">
                Project Title <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Project name"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-location" className="text-xs font-semibold">
                  Site Location <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="edit-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Location"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-tech" className="text-xs font-semibold">
                  Technology Type
                </Label>
                <Input
                  id="edit-tech"
                  value={techType}
                  onChange={(e) => setTechType(e.target.value)}
                  placeholder="Tech"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-capacity" className="text-xs font-semibold">
                  Power Capacity (Watts)
                </Label>
                <Input
                  id="edit-capacity"
                  type="number"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="Watts"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-portfolio" className="text-xs font-semibold">
                  Portfolio
                </Label>
                <select
                  id="edit-portfolio"
                  value={portfolioId}
                  onChange={(e) => setPortfolioId(e.target.value)}
                  className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
                >
                  <option value="">No portfolio</option>
                  {portfolios.map((portfolio) => (
                    <option key={portfolio.id} value={portfolio.id}>
                      {portfolio.code ? `${portfolio.code} — ${portfolio.name}` : portfolio.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-manager" className="text-xs font-semibold">
                  Project Manager
                </Label>
                <select
                  id="edit-manager"
                  value={managerId}
                  onChange={(e) => setManagerId(e.target.value)}
                  className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
                >
                  <option value="">Unassigned</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name || `${p.first_name} ${p.last_name}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-start" className="text-xs font-semibold">
                  Start Date <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="edit-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-end" className="text-xs font-semibold">
                  Target End Date <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="edit-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-status" className="text-xs font-semibold">
                Project Status
              </Label>
              <select
                id="edit-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
              >
                <option value="planning">Planning</option>
                <option value="active">Ongoing (Active)</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-desc" className="text-xs font-semibold">
                Project Description
              </Label>
              <Textarea
                id="edit-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description"
                rows={3}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
