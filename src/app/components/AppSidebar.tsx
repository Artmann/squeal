import { MessageSquareIcon, PlusIcon, ShapesIcon } from 'lucide-react'
import { ReactElement } from 'react'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'

export function AppSidebar(): ReactElement {
  return (
    <Sidebar>
      <SidebarHeader />
      <SidebarContent>
        <SidebarGroup className="flex-1">
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupAction title="New Project">
            <a href="/projects/new">
              <PlusIcon className="size-3 text-subtext-0 hover:text-text" />{' '}
              <span className="sr-only">New Project</span>
            </a>
          </SidebarGroupAction>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Application</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/chat">
                    <MessageSquareIcon className="size-3" />

                    <span>Chat</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/providers">
                    <ShapesIcon className="size-3" />

                    <span>Providers</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter />
    </Sidebar>
  )
}
