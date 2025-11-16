/* 
   Linux launcher

   Copyright (c) 2011 Fabrice Bellard

   Redistribution or commercial use is prohibited without the author's
   permission.
*/
"use strict";

var term, pc, boot_start_time, db;

function init_db() {
    const request = indexedDB.open("JSLinuxDB", 1);

    request.onupgradeneeded = (event) => {
        const db = event.target.result;
        db.createObjectStore("files", { keyPath: "name" });
    };

    request.onsuccess = (event) => {
        db = event.target.result;
        console.log("IndexedDB initialized");
    };

    request.onerror = (event) => {
        console.error("IndexedDB error:", event.target.error);
    };
}

function term_start()
{
    term = new Term(null, null, term_handler);

    term.open();
}

/* send chars to the serial port */
function term_handler(str)
{
    pc.serial.send_chars(str);
}

function clipboard_set(val)
{
    var el;
    el = document.getElementById("text_clipboard");
    el.value = val;
}

function clipboard_get()
{
    var el;
    el = document.getElementById("text_clipboard");
    return el.value;
}

function clear_clipboard()
{
    var el;
    el = document.getElementById("text_clipboard");
    el.value = "";
}

/* just used to display the boot time in the VM */
function get_boot_time()
{
    return (+new Date()) - boot_start_time;
}

/* global to hold binary data from async XHR requests */
var binaries = [false,false,false];

function loadbinary(url, slot, save_local) {
    var req, binary_array, len, typed_arrays_exist;

    req = new XMLHttpRequest();

    req.open('GET', url, true);

    typed_arrays_exist = ('ArrayBuffer' in window && 'Uint8Array' in window);
    if (typed_arrays_exist && 'mozResponseType' in req) {
        req.mozResponseType = 'arraybuffer';
    } else if (typed_arrays_exist && 'responseType' in req) {
        req.responseType = 'arraybuffer';
    } else {
        req.overrideMimeType('text/plain; charset=x-user-defined');
        typed_arrays_exist = false;
    }

    req.onerror = function(e) {
      throw "Error while loading " + req.statusText;
    };

    req.onload = function (e) {
      console.log('onload triggered for ' + url);
      if (req.readyState === 4) {
        if (req.status === 200) {
            var data;
          if (typed_arrays_exist && 'mozResponse' in req) {
            data = req.mozResponse;
          } else if (typed_arrays_exist && req.mozResponseArrayBuffer) {
            data = req.mozResponseArrayBuffer;
          } else if ('responseType' in req) {
            data = req.response;
          } else {
            data = req.responseText;
          }
          binaries[slot] = data;

          if (save_local && data instanceof ArrayBuffer) {
              const transaction = db.transaction(["files"], "readwrite");
              const objectStore = transaction.objectStore("files");
              const request = objectStore.put({ name: url, data: data });
              request.onsuccess = () => {
                  console.log(url + " saved to IndexedDB");
              };
              request.onerror = (event) => {
                  console.error("Could not save " + url + " to IndexedDB:", event.target.error);
              };
          }
        } else {
          throw "Error while loading " + url;
        }
      }
    }

    req.send(null);
};

function checkbinaries() {
    //console.log("checkbinaries: ",(binaries[0]!=false),(binaries[1]!=false),(binaries[2]!=false));
    if((binaries[0] != false) && (binaries[1] != false) && (binaries[2] != false)){
        console.log("...binaries done loading, calling start()")
        start();
    } else {
         setTimeout(checkbinaries, 500);
    }
};

function load_binaries() {
    console.log("requesting binaries");
    loadbinary("vmlinux-2.6.20.bin", 0);

    if (db) {
        const transaction = db.transaction(["files"], "readonly");
        const objectStore = transaction.objectStore("files");
        const request = objectStore.get("root.bin");

        request.onsuccess = (event) => {
            if (event.target.result) {
                console.log("loading root.bin from IndexedDB");
                binaries[1] = event.target.result.data;
            } else {
                console.log("loading root.bin from server");
                loadbinary("root.bin", 1, true);
            }
        };

        request.onerror = (event) => {
            console.error("Error loading root.bin from IndexedDB:", event.target.error);
            console.log("loading root.bin from server");
            loadbinary("root.bin", 1, true);
        };
    } else {
        setTimeout(load_binaries, 100);
        return;
    }

    loadbinary("linuxstart.bin", 2);

    console.log("waiting for binaries to finish loading...");
    checkbinaries();
}

function start()
{
    var start_addr, initrd_size, params, cmdline_addr;
    
    params = new Object();

    /* serial output chars */
    params.serial_write = term.write.bind(term);

    /* memory size (in bytes) */
    params.mem_size = 16 * 1024 * 1024;

    /* clipboard I/O */
    params.clipboard_get = clipboard_get;
    params.clipboard_set = clipboard_set;

    params.get_boot_time = get_boot_time;

    pc = new PCEmulator(params);

    pc.load_binary(binaries[0], 0x00100000);

    initrd_size = pc.load_binary(binaries[1], 0x00400000);

    start_addr = 0x10000;
    pc.load_binary(binaries[2], start_addr);

    /* set the Linux kernel command line */
    /* Note: we don't use initramfs because it is not possible to
       disable gzip decompression in this case, which would be too
       slow. */
    cmdline_addr = 0xf800;
    pc.cpu.write_string(cmdline_addr, "console=ttyS0 root=/dev/ram0 rw init=/sbin/init notsc=1");

    pc.cpu.eip = start_addr;
    pc.cpu.regs[0] = params.mem_size; /* eax */
    pc.cpu.regs[3] = initrd_size; /* ebx */
    pc.cpu.regs[1] = cmdline_addr; /* ecx */

    boot_start_time = (+new Date());

    pc.start();

    setInterval(save_root_bin, 10000);
}

function save_root_bin() {
    var ramdisk = pc.get_ramdisk_image();
    const transaction = db.transaction(["files"], "readwrite");
    const objectStore = transaction.objectStore("files");
    const request = objectStore.put({ name: "root.bin", data: ramdisk });

    request.onsuccess = () => {
        console.log("root.bin saved to IndexedDB");
    };

    request.onerror = (event) => {
        console.error("Could not save root.bin to IndexedDB:", event.target.error);
    };
}

init_db();
term_start();
