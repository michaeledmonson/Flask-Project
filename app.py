# -*- coding: utf-8 -*-
"""
Created on Tue Apr 21 14:57:17 2020

@author: etill
"""

#import statements
from flask import Flask, render_template

#Flask app variable
app = Flask(__name__)

#static route
@app.route("/")
def hello():
    return render_template("index.html")

@app.route("/1006")
def test123():
    return render_template("1006.html")

@app.route("/bayblades")
def bayblades():
    return "Let 'er rip!!"

#start the server
if __name__ == "__main__":
    app.run()