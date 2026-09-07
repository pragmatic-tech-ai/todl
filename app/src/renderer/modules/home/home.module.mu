// Home module — the single placeholder capability for the bare shell scaffold.
// Its service is the HomeVM (registered below); the shell's side panel renders
// it via DataTemplate[HomeVM] (home.resources.mu). The rail shows one item
// (Name + Icon); selecting it reveals the side panel hosting the HomeVM.
import HomeVM from "./home-vm.ts"

module HomeModule [ Name = "Home" ] {
    .services: { HomeVM }

    Capability [
        Name       = "Home",
        Icon       = @Home,
        ServiceKey = HomeVM
    ]
}
