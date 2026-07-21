# Page Templates

This directory contains template files for creating new pages in the Matrix application. Use these templates as starting points to ensure consistency across the application.

## Available Templates

### 1. List Page Template (`list-page.template.tsx`)

Use for pages that display lists/tables of items with:
- Stats cards at the top
- Filter section
- Table or grid of items
- Empty states

**Examples**: employee list, Tasks list, Products list, Projects list

### 2. Form Page Template (`form-page.template.tsx`)

Use for pages with forms for creating or editing items:
- Two-column layout (main form + sidebar)
- Form validation
- Related dropdowns

**Examples**: New Product, Edit Profile, Create Task

### 3. Detail Page Template (`detail-page.template.tsx`)

Use for pages that display detailed view of a single item:
- Header with actions (Edit, Delete)
- Main content with sections
- Sidebar with meta information

**Examples**: Project detail, employee profile, Task detail

## How to Use

1. Copy the relevant template file to your new route directory
2. Rename it to `page.tsx`
3. Update the types, data fetching logic, and UI as needed
4. Create a corresponding `loading.tsx` using the skeleton components

## Key Patterns

### SSR Data Fetching

All pages should follow the SSR pattern:

```tsx
async function getPageData() {
  const supabase = await createClient()
  
  // 1. Check authentication
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { redirect: "/auth/login" }
  
  // 2. Check authorization (optional)
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  if (!profile || !["admin", "super_admin"].includes(profile.role)) {
    return { redirect: "/dashboard" }
  }
  
  // 3. Fetch data
  const { data } = await supabase.from("items").select("*").order("created_at", { ascending: false })
  
  return { items: data || [] }
}
```

### Layout Components

Use the layout components from `@/components/layout`:

```tsx
import { PageWrapper, PageHeader, Section } from "@/components/layout"

<PageWrapper maxWidth="full" background="gradient">
  <PageHeader
    title="Dashboard"
    description="Welcome to the admin panel"
    icon={Shield}
    actions={<Button>Action</Button>}
  />
  <Section title="Recent Activity">
    {/* content */}
  </Section>
</PageWrapper>
```

**PageWrapper Props:**
- `maxWidth`: `"full"` | `"content"` | `"form"` | `"narrow"`
- `background`: `"gradient"` | `"plain"`
- `padding`: `"standard"` | `"compact"` | `"none"`

### Stat Cards

Use `StatCard` from `@/components/ui/stat-card`:

```tsx
<StatCard
  title="Total employee"
  value={120}
  icon={Users}
  iconBgColor="bg-blue-100 dark:bg-blue-900/30"
  iconColor="text-blue-600 dark:text-blue-400"
  variant="compact" // "default" | "compact" | "large"
/>
```

### Loading States

Create a `loading.tsx` file using skeleton components:

```tsx
import { TablePageSkeleton } from "@/components/skeletons"

export default function Loading() {
  return <TablePageSkeleton filters={3} columns={6} rows={8} showStats={true} />
}
```

Available skeletons:
- `DashboardSkeleton` - For dashboard pages
- `TablePageSkeleton` - For list/table pages
- `DetailPageSkeleton` - For detail/view pages
- `FormPageSkeleton` - For form pages

### Empty States

Use `EmptyState` from `@/components/ui/empty-state`:

```tsx
<EmptyState
  icon={Package}
  title="No products yet"
  description="Get started by adding your first product."
  action={{ label: "Add Product", href: "/products/new", icon: Plus }}
/>
```

## File Structure

When creating a new feature, follow this structure:

```
app/admin/[feature]/
├── page.tsx              # Main list page (SSR)
├── loading.tsx           # Loading skeleton
├── [id]/
│   ├── page.tsx          # Detail page (SSR)
│   ├── loading.tsx       # Loading skeleton
│   └── edit/
│       ├── page.tsx      # Edit form (SSR)
│       └── loading.tsx   # Loading skeleton
└── new/
    ├── page.tsx          # Create form (SSR)
    └── loading.tsx       # Loading skeleton
```

## Services

For data operations, use the service layer in `@/services`:

```tsx
import { productService, taskService } from "@/services"

// Use in SSR pages
const products = await productService.getAllWithCategories()
const stats = await productService.getStats()
```

Available services:
- `BaseService` - Base class with common CRUD operations
- `ProductService` - For product management
- `TaskService` - For task management
- `PaymentService` - For payment management
- `EmployeeService` - For employee management
