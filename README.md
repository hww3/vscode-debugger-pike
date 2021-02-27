# Summary

This extension provides support for debugging Pike code in Visual Studio Code. In order to use this extension, you must have a version of Pike that supports debugging and is compiled with the --with-debug option. For best results while debugging, the pike you use should also be compiled with the --without-machine-code option. 

*Tip:* also install the Pike language extension, available from the Extensions Marketplace. The Pike language extension provides some basic syntax highlighting and code folding support. 

## Notes and Caveats

Most of the following discussion refer to limitations in the Pike debugging subsystem, or in a complication involving the ability of an IDE to express what you really want to do to the debugger. If things don't seem to work the way you should, have a look here to see if it's a known limitation.

### Machine Code and Optimization

A killer feature of Pike is its ability to use native machine code in its compiled programs. Machine code runs faster than interpreted code and sometimes runs many times faster. While this is a boon at runtime, it can wreak havoc when trying to use a debugger. That's because machine code generation coupled with the advanced optimization that Pike performs when compiling code can result in a non-linear execution path compared to the original source. When machine code is enabled, the interpreter often bundles multiple lines of code into one operation, sometimes during program initialization such that not every line will be executed when stepping, and some may never provide an opportunity for the debugger to break execution. It's still possible to debug when machine code is being used, but the flow of execution and granularity may make it more difficult to examine what's happening. Having a copy of pike installed that has machine code generation disabled (possibly in parallel to one that's enabled) allows for a more reasonable debugging session.

### Breakpoints

The debugger is able to create breakpoints on pretty much any line of Pike code. There are, however, some situations that may prove confusing, so we'll discuss them here. Basically, IDEs such as Visual Studio Code like to define breakpoints in terms of a concrete file on disk and a line within that file. The Pike runtime, however, deals strictly interms of the "program". A given file is always a program, but it can contain nested programs and so forth. Pike can also create programs from arbitrary strings unassociated with a file at all. For the bulk of code most people will write, this doesn't cause much confusion and the IDE and Pike debugger get along without too much trouble. However, there are a few cases that may require special handling or cause confusion:

1. Use of the preprocessor

The preprocessor is a double edged sword: It allows a lot of problems to be solved that would otherwise require a lot of repetition or boilerplate, but it can also cause some real headaches. The include directive can be used to insert code one (or more) times into the same file. When compiling a file with this sort of scenario, the ability of Pike to create a breakboint becomes a lot more complicated: if the line you wish to break on is in a file that gets included in another, you have to specify the breakpoint interms of the containing pike file because that's the compilation unit and usually the source of the program.

Internally, Pike provides a provision for this: to create a breakpoint on a particular point in a program corresponding to a location in a file that might not be the file the program is actually defined in (like in the case of a file included in another). However, IDEs tend not to have a way to express this multi-layeredness so it may not be possible for you to do this directly in the IDE (though you could add some temporary code in the code you'll be debugging to create those particular "nested" breakpoints yourself. 

Conversely, putting a breakpoint on a file that gets included into another (or possibly many) file is something that an IDE will commonly permit. Unfortunately, it probably won't cause any breaks because that include file isn't usually the the thing that Pike is compiling into a program. This particular scenario could be solved, but it would likely cause an unacceptable performance hit when debugging. If you really needed to be able to do this, you could probably create a breakpoint for each program that includes the file, in the same manner as the previous case.

Macros may cause confusion as well. Breakpoints on macros included from another file carry all of the caveats as the previous situation. It should be possible to create a breakpoint on a macro defined elsewhere in the same file because cpp() includes the source source location when it derefrences macros. The Pike debugger is also clever enough to scan an entire program for all possible occurances of the line. This means that a breakpoint on a single line might effectively cause halts across a wide portion of a program.

2. Programs compiled outside of the master

Programs that make use of compile_file() and compile_string() may also cause unexpected behavior because these functions do not register the programs they create with the master. When creating a breakpoint based on a file path and line number, the debugger asks the Pike master program for the program corresponding to the file. If the file hasn't been loaded yet, the breakpoint is created in a "pending" state and will be enabled once the master loads it into its program cache. 

A number of Pike programs sidestep the master and perform program compilation directly themselves. Roxen and the Fins web framework both do this for various reasons such as allowing modules to be reloaded from disk without having to restart the whole process. Their "deceit" is even greater because they often broadly refer to a connection between a module and its source file. However, because the programs generated in this way aren't registered with the master so breakpoints made against such files will never transition from "pending". You could programmatically create breakpoints in your code as provision is made for creating breakpoints from the file path, line number /and/ program. Recompiling a program from a file will result in a new program however, and your breakpoints will not have been registered against the new program. Probably a better approach would be for these types of program to integrate with the debugger's breakpoint resolution system. Doing this would permit breakpoints to resolve in the first place, and could also theoretically permit breakpoints to be updated when files and programs associated with them are updated.
 
### Viewing and changing variables

Variables in both the local (function) and global (object) scope can be viewed and changed. Variables containing multiple elements (that is, reference types such as arrays, mappings and objects) are displayed as an expanding list showing keys and values. The debugger is able to "burrow" down multiple levels as they are unfolded. Values that are "unitary" (such as numbers and strings) are displayed in the manner of the "%O" operator in Pike's sprintf() method. So, if you see a value that looks like this: "123", you know that is a string rather than the int 123. Similarly, when modifying values, they should be provided in the same manner. Setting the value of a variable to 123 makes the value an int. If you try to set a value to a string, don't forget to include the quotation marks, otherwise you'll get failures or unexpected results if the value happens to be a number. 

Special care must be used when setting values that are reference types. This is because multiple variables (across multiple objects perhaps) may hold a reference to the value. If you replace a variable that contains a mapping with a mapping, you are effectively creating a new thing that may look like the value that was previously there, but is unique and no longer a shared value. Depending on the situation, this may not be a problem, but it can be the source of much confusion, both for you and your programs.  


